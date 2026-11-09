/** Stripe Checkout + webhook (optional) */
import type { Env } from "../env";
import type { PlanId } from "../lib/plans";
import { stripeAction, verifyStripeSignature, type StripeEvent } from "../lib/stripe-core";
import { findTeamByStripeSubscription, setTeamPlan } from "./api-key-store";

/** Billing is on only when all three Stripe secrets are set. */
export function stripeConfigured(env: Env): boolean {
  return Boolean(
    env.STRIPE_SECRET_KEY?.trim() && env.STRIPE_PRICE_PRO?.trim() && env.STRIPE_WEBHOOK_SECRET?.trim()
  );
}

/** Self-serve Stripe checkout: free → pro only */
export function canUpgradeViaStripe(plan: PlanId): boolean {
  return plan === "free";
}

export async function createCheckoutSession(
  env: Env,
  input: { teamId: string; successUrl: string; cancelUrl: string; email?: string }
): Promise<{ url: string; sessionId: string }> {
  const secret = env.STRIPE_SECRET_KEY!.trim();
  const price = env.STRIPE_PRICE_PRO!.trim();

  const body = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.teamId,
    "metadata[team_id]": input.teamId,
    "subscription_data[metadata][team_id]": input.teamId,
  });
  if (input.email) body.set("customer_email", input.email);

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const data = (await res.json()) as {
    url?: string;
    id?: string;
    error?: { message?: string };
  };
  if (!res.ok || !data.url) {
    throw new Error(data.error?.message ?? `Stripe ${res.status}`);
  }
  return { url: data.url, sessionId: data.id! };
}

export async function createBillingPortalSession(
  env: Env,
  input: { customerId: string; returnUrl: string }
): Promise<{ url: string }> {
  const secret = env.STRIPE_SECRET_KEY!.trim();
  const body = new URLSearchParams({
    customer: input.customerId,
    return_url: input.returnUrl,
  });

  const res = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const data = (await res.json()) as {
    url?: string;
    error?: { message?: string };
  };
  if (!res.ok || !data.url) {
    throw new Error(data.error?.message ?? `Stripe ${res.status}`);
  }
  return { url: data.url };
}

const PROCESSED_TTL_SECONDS = 7 * 24 * 3600;
const processedKey = (eventId: string) => `stripe:evt:${eventId}`;

/** Verified Stripe webhook → teams.plan. Idempotent: replays of a handled event id are skipped. */
export async function handleStripeWebhook(
  env: Env,
  payload: string,
  signatureHeader: string | undefined
): Promise<{ duplicate: boolean }> {
  const secret = env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) throw new Error("stripe_webhook_not_configured");

  const ok = await verifyStripeSignature(payload, signatureHeader, secret);
  if (!ok) throw new Error("invalid_stripe_signature");

  const event = JSON.parse(payload) as StripeEvent;
  const kv = env.RATE_LIMIT;
  if (event.id && kv && (await kv.get(processedKey(event.id)))) {
    return { duplicate: true };
  }

  const action = stripeAction(event);
  if (action.kind === "upgrade") {
    await setTeamPlan(env, action.teamId, "pro", {
      customerId: action.customerId ?? undefined,
      subscriptionId: action.subscriptionId,
    });
  } else if (action.kind === "subscription") {
    // Only the team's current subscription can change its plan.
    const team = await findTeamByStripeSubscription(env, action.subscriptionId);
    if (team) {
      await setTeamPlan(env, team.id, action.active ? "pro" : "free", {
        subscriptionId: action.subscriptionId,
      });
    }
  }

  // Mark handled only after success, so Stripe retries a failed delivery.
  if (event.id && kv) {
    await kv.put(processedKey(event.id), "1", { expirationTtl: PROCESSED_TTL_SECONDS });
  }
  return { duplicate: false };
}

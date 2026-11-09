/**
 * Self-serve Pro billing without an API key in the browser.
 * GET  /v1/upgrade/config                       → { billing: boolean }
 * POST /v1/upgrade/request { email, action }    → emails a one-time link (action: checkout | portal)
 * POST /v1/upgrade/confirm { token }            → { url } of Stripe Checkout or the customer portal
 * Without all Stripe secrets every write endpoint returns 503 stripe_not_configured.
 */
import { Hono } from "hono";
import type { Env } from "../env";
import { getDb } from "../db/client";
import { createResendClient } from "../services/resend-mail";
import { getTeamBilling } from "../services/api-key-store";
import {
  canUpgradeViaStripe,
  createBillingPortalSession,
  createCheckoutSession,
  stripeConfigured,
} from "../services/billing";
import { normalizePlan } from "../lib/plans";
import { workspaceUrl } from "../lib/public-origin";
import { hourlyLimitHit } from "../lib/hourly-limit";
import { SIGNUP_TOKEN_TTL_SECONDS, newSignupToken, normalizeSignupEmail, sha256Hex } from "../lib/key-signup";
import { billingLinkEmail, noAccountEmail, parseBillingAction, type BillingAction } from "../lib/billing-link";

export const upgradeRoutes = new Hono<{ Bindings: Env }>();

const CONTACT = "hello@webmailagent.com";
const tokenKey = (hash: string) => `billing:tok:${hash}`;
const unavailable = { error: "stripe_not_configured", contact: CONTACT } as const;

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Self-serve keys map email → team in KV; teams are also named by their email. */
async function findTeamIdByEmail(env: Env, kv: KVNamespace, email: string): Promise<string | null> {
  const fromKv = await kv.get(`keysignup:email:${await sha256Hex(email)}`);
  if (fromKv) return fromKv;
  const rows = (await getDb(env)`
    SELECT id FROM teams WHERE lower(name) = ${email} ORDER BY created_at ASC LIMIT 1
  `) as { id: string }[];
  return rows[0]?.id ?? null;
}

upgradeRoutes.get("/config", (c) => {
  c.header("Cache-Control", "public, max-age=300");
  return c.json({ billing: stripeConfigured(c.env) });
});

upgradeRoutes.post("/request", async (c) => {
  const kv = c.env.RATE_LIMIT;
  const from = c.env.OUTBOUND_FROM?.trim();
  if (!stripeConfigured(c.env) || !kv || !from || !c.env.RESEND_API_KEY) return c.json(unavailable, 503);

  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  if (await hourlyLimitHit(kv, c.executionCtx, `billing:ip:${ip}`, 5)) {
    return c.json({ error: "rate_limit_exceeded", retryAfterSeconds: 3600 }, 429);
  }

  const body = await readJson(c.req.raw);
  if (!body) return c.json({ error: "invalid_json" }, 400);
  if (typeof body.website === "string" && body.website.trim()) return c.json({ status: "sent" }, 202);

  const action = parseBillingAction(body.action);
  if (!action) return c.json({ error: "invalid_action", field: "action" }, 400);
  const email = normalizeSignupEmail(body.email);
  if (!email) return c.json({ error: "invalid_email", field: "email" }, 400);

  if (await hourlyLimitHit(kv, c.executionCtx, `billing:em:${await sha256Hex(email)}`, 3)) {
    return c.json({ error: "rate_limit_exceeded", retryAfterSeconds: 3600 }, 429);
  }

  // Same answer whether or not the email has an account: no account enumeration.
  const teamId = await findTeamIdByEmail(c.env, kv, email);
  let mail: { subject: string; text: string };
  if (teamId) {
    const token = newSignupToken();
    await kv.put(tokenKey(await sha256Hex(token)), JSON.stringify({ teamId, email, action }), {
      expirationTtl: SIGNUP_TOKEN_TTL_SECONDS,
    });
    mail = billingLinkEmail(action, `${workspaceUrl("/upgrade.html", c.env.MAILAGENT_WORKSPACE_ORIGIN)}#t=${token}`);
  } else {
    mail = noAccountEmail(workspaceUrl("/get-key.html", c.env.MAILAGENT_WORKSPACE_ORIGIN));
  }

  const { error } = await createResendClient(c.env).emails.send({ from, to: [email], ...mail });
  if (error) {
    console.error("billing_link_send_failed", error.message);
    return c.json({ error: "send_failed", contact: CONTACT }, 502);
  }
  return c.json({ status: "sent" }, 202);
});

upgradeRoutes.post("/confirm", async (c) => {
  const kv = c.env.RATE_LIMIT;
  if (!stripeConfigured(c.env) || !kv) return c.json(unavailable, 503);

  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  if (await hourlyLimitHit(kv, c.executionCtx, `billing:confirm:${ip}`, 20)) {
    return c.json({ error: "rate_limit_exceeded", retryAfterSeconds: 3600 }, 429);
  }

  const body = await readJson(c.req.raw);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token || token.length > 128) return c.json({ error: "invalid_or_expired_token" }, 400);

  const key = tokenKey(await sha256Hex(token));
  const raw = await kv.get(key);
  if (!raw) return c.json({ error: "invalid_or_expired_token" }, 400);
  await kv.delete(key); // one-time

  const { teamId, email, action } = JSON.parse(raw) as { teamId: string; email: string; action: BillingAction };
  const team = await getTeamBilling(c.env, teamId);
  if (!team) return c.json({ error: "invalid_or_expired_token" }, 400);

  try {
    if (action === "checkout") {
      const plan = normalizePlan(team.plan);
      if (!canUpgradeViaStripe(plan)) return c.json({ error: "already_pro", plan }, 409);
      const session = await createCheckoutSession(c.env, {
        teamId,
        email,
        successUrl: workspaceUrl("/upgrade.html?billing=success", c.env.MAILAGENT_WORKSPACE_ORIGIN),
        cancelUrl: workspaceUrl("/upgrade.html?billing=cancel", c.env.MAILAGENT_WORKSPACE_ORIGIN),
      });
      return c.json({ action, url: session.url });
    }
    if (!team.stripe_customer_id) return c.json({ error: "no_subscription" }, 409);
    const portal = await createBillingPortalSession(c.env, {
      customerId: team.stripe_customer_id,
      returnUrl: workspaceUrl("/upgrade.html?billing=portal", c.env.MAILAGENT_WORKSPACE_ORIGIN),
    });
    return c.json({ action, url: portal.url });
  } catch (e) {
    console.error("billing_confirm_failed", e instanceof Error ? e.message : String(e));
    return c.json({ error: "stripe_failed", contact: CONTACT }, 502);
  }
});

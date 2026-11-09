/** Stripe helpers without I/O: signature check and event → plan decision. */

export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;

export type StripeEvent = {
  id?: string;
  type: string;
  data: { object: Record<string, unknown> };
};

export type StripeAction =
  | { kind: "upgrade"; teamId: string; customerId: string | null; subscriptionId: string | null }
  | { kind: "subscription"; subscriptionId: string; active: boolean }
  | { kind: "ignore" };

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

export function subscriptionIsActive(status: unknown): boolean {
  return typeof status === "string" && ACTIVE_STATUSES.has(status);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

export function stripeAction(event: StripeEvent): StripeAction {
  const obj = event.data?.object ?? {};
  switch (event.type) {
    case "checkout.session.completed": {
      if (obj.mode !== "subscription") return { kind: "ignore" };
      const paid = obj.payment_status === "paid" || obj.payment_status === "no_payment_required";
      if (!paid) return { kind: "ignore" };
      const teamId = str(obj.client_reference_id) ?? str((obj.metadata as Record<string, unknown> | null)?.team_id);
      if (!teamId) return { kind: "ignore" };
      return { kind: "upgrade", teamId, customerId: str(obj.customer), subscriptionId: str(obj.subscription) };
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscriptionId = str(obj.id);
      if (!subscriptionId) return { kind: "ignore" };
      const active = event.type === "customer.subscription.updated" && subscriptionIsActive(obj.status);
      return { kind: "subscription", subscriptionId, active };
    }
    default:
      return { kind: "ignore" };
  }
}

/** Verify a Stripe-Signature header (t=…,v1=…) with HMAC-SHA256 and a replay window. */
export async function verifyStripeSignature(
  payload: string,
  header: string | undefined,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  toleranceSeconds: number = STRIPE_SIGNATURE_TOLERANCE_SECONDS
): Promise<boolean> {
  if (!header || !secret) return false;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const piece of header.split(",")) {
    const at = piece.indexOf("=");
    if (at < 1) continue;
    const key = piece.slice(0, at).trim();
    const value = piece.slice(at + 1).trim();
    if (key === "t") timestamp = Number(value);
    if (key === "v1" && value) signatures.push(value);
  }
  if (timestamp === null || !Number.isFinite(timestamp) || !signatures.length) return false;
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;

  // Stripe signs with the whole "whsec_…" string as the HMAC key.
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return signatures.some((sig) => timingSafeEqual(sig, expected));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Calendar month bucket in UTC, e.g. "2026-11". */
export function monthKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

/** Stripe billing: webhook signature, event → plan, email links, plan caps */
import assert from "node:assert/strict";
import { monthKey, stripeAction, subscriptionIsActive, verifyStripeSignature } from "../src/lib/stripe-core";
import { billingLinkEmail, noAccountEmail, parseBillingAction } from "../src/lib/billing-link";
import { PLAN_LIMITS } from "../src/lib/plans";
import { stripeConfigured } from "../src/services/billing";
import type { Env } from "../src/env";
import { monthlyQuotaStatus } from "../src/services/email-usage";

async function sign(secret: string, t: number, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Signature: the whole whsec_ string is the HMAC key, 5 minute window.
const secret = "whsec_test_secret";
const payload = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
const now = 1_800_000_000;
const v1 = await sign(secret, now, payload);
assert.equal(await verifyStripeSignature(payload, `t=${now},v1=${v1}`, secret, now), true);
assert.equal(await verifyStripeSignature(payload, `t=${now},v1=deadbeef,v1=${v1}`, secret, now), true, "any v1 may match");
assert.equal(await verifyStripeSignature(payload, `t=${now},v1=${v1}`, secret, now + 299), true);
assert.equal(await verifyStripeSignature(payload, `t=${now},v1=${v1}`, secret, now + 301), false, "too old");
assert.equal(await verifyStripeSignature(payload, `t=${now},v1=${v1}`, secret, now - 301), false, "from the future");
assert.equal(await verifyStripeSignature(payload + " ", `t=${now},v1=${v1}`, secret, now), false, "body changed");
assert.equal(await verifyStripeSignature(payload, `t=${now},v1=${v1}`, "whsec_other", now), false, "wrong secret");
assert.equal(await verifyStripeSignature(payload, `v1=${v1}`, secret, now), false, "no timestamp");
assert.equal(await verifyStripeSignature(payload, undefined, secret, now), false);

// Events → plan decisions.
const completed = (obj: Record<string, unknown>) =>
  stripeAction({ type: "checkout.session.completed", data: { object: obj } });
assert.deepEqual(
  completed({ mode: "subscription", payment_status: "paid", client_reference_id: "team_1", customer: "cus_1", subscription: "sub_1" }),
  { kind: "upgrade", teamId: "team_1", customerId: "cus_1", subscriptionId: "sub_1" }
);
assert.deepEqual(
  completed({ mode: "subscription", payment_status: "paid", metadata: { team_id: "team_2" } }),
  { kind: "upgrade", teamId: "team_2", customerId: null, subscriptionId: null }
);
assert.equal(completed({ mode: "subscription", payment_status: "unpaid", client_reference_id: "t" }).kind, "ignore");
assert.equal(completed({ mode: "payment", payment_status: "paid", client_reference_id: "t" }).kind, "ignore");
assert.equal(completed({ mode: "subscription", payment_status: "paid" }).kind, "ignore");

const sub = (type: string, status: string) => stripeAction({ type, data: { object: { id: "sub_1", status } } });
assert.deepEqual(sub("customer.subscription.updated", "active"), { kind: "subscription", subscriptionId: "sub_1", active: true });
assert.deepEqual(sub("customer.subscription.updated", "trialing"), { kind: "subscription", subscriptionId: "sub_1", active: true });
for (const status of ["past_due", "unpaid", "canceled", "incomplete", "incomplete_expired", "paused"]) {
  assert.equal((sub("customer.subscription.updated", status) as { active: boolean }).active, false, status);
}
assert.equal((sub("customer.subscription.deleted", "active") as { active: boolean }).active, false, "deleted is always free");
assert.equal(stripeAction({ type: "invoice.paid", data: { object: {} } }).kind, "ignore");
assert.equal(subscriptionIsActive("active"), true);
assert.equal(subscriptionIsActive(undefined), false);

// Billing is on only with all three secrets.
const env = (over: Partial<Env>) => over as Env;
assert.equal(stripeConfigured(env({})), false);
assert.equal(stripeConfigured(env({ STRIPE_SECRET_KEY: "sk", STRIPE_PRICE_PRO: "price" })), false);
assert.equal(
  stripeConfigured(env({ STRIPE_SECRET_KEY: "sk", STRIPE_PRICE_PRO: "price", STRIPE_WEBHOOK_SECRET: "whsec" })),
  true
);

// Email links.
assert.equal(parseBillingAction("checkout"), "checkout");
assert.equal(parseBillingAction("portal"), "portal");
assert.equal(parseBillingAction("refund"), null);
const up = billingLinkEmail("checkout", "https://webmailagent.com/upgrade.html#t=abc");
assert.match(up.text, /upgrade\.html#t=abc/);
assert.match(up.text, /\$29\/month/);
assert.doesNotMatch(up.text, /ma_|—|·/, "no key, no long dash, no middle dot");
assert.match(billingLinkEmail("portal", "x").subject, /Manage/);
assert.match(noAccountEmail("https://webmailagent.com/get-key.html").text, /get-key\.html/);

// Plan caps.
assert.equal(PLAN_LIMITS.free.monthlyEmails, 500);
assert.equal(PLAN_LIMITS.pro.monthlyEmails, 5000);
assert.equal(PLAN_LIMITS.enterprise.monthlyEmails, null);
assert.equal(PLAN_LIMITS.legacy.monthlyEmails, null);
assert.equal(PLAN_LIMITS.pro.maxActiveInboxes, 100);
assert.equal(PLAN_LIMITS.pro.rateLimitPerMinute, 300);
assert.equal(monthKey(new Date("2026-11-30T23:59:59Z")), "2026-11");
assert.equal(monthKey(new Date("2026-12-01T00:00:00Z")), "2026-12");

// Wait timeout and diagnose explain the monthly cap.
assert.equal(monthlyQuotaStatus(499, "free"), null);
const over = monthlyQuotaStatus(500, "free");
assert.equal(over?.error, "monthly_quota_exceeded");
assert.equal(over?.limit, 500);
assert.equal(over?.plan, "free");
assert.match(over!.message, /^monthly_quota_exceeded: 500 emails per month on the free plan/);
assert.match(over!.message, /Upgrade to Pro/);
assert.match(over!.message, /Inbound email is not delivered/);
assert.equal(monthlyQuotaStatus(5000, "pro")?.limit, 5000);
assert.doesNotMatch(monthlyQuotaStatus(5000, "pro")!.message, /Upgrade/);
assert.equal(monthlyQuotaStatus(1_000_000, "enterprise"), null);
assert.equal(monthlyQuotaStatus(1_000_000, "legacy"), null);

console.log("billing: ok");

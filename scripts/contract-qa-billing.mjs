#!/usr/bin/env node
/** Contract: billing shape; checkout 503 when Stripe off; skip live payment */
import "./load-env.mjs";
import { contractApi, contractBase, contractHeaders } from "./lib/contract-api.mjs";

const base = contractBase();
const headers = contractHeaders();
if (!headers) {
  console.error("contract-qa-billing: set MAILAGENT_API_KEY");
  process.exit(1);
}

async function main() {
  console.log("contract-qa-billing →", base);

  const me = await contractApi(base, headers, "/v1/me");
  if (!me.ok) {
    console.error("GET /v1/me failed", me.status, me.json);
    process.exit(1);
  }

  const b = me.json.billing;
  if (
    b?.checkoutPath !== "/v1/billing/checkout" ||
    b?.portalPath !== "/v1/billing/portal" ||
    typeof b.stripeEnabled !== "boolean" ||
    typeof b.canUpgrade !== "boolean" ||
    typeof b.canManagePortal !== "boolean"
  ) {
    console.error("billing shape invalid", b);
    process.exit(1);
  }

  if (!b.stripeEnabled) {
    const checkout = await contractApi(base, headers, "/v1/billing/checkout", {
      method: "POST",
      body: {},
    });
    if (checkout.status !== 503 || checkout.json?.error !== "stripe_not_configured") {
      console.error("expected stripe_not_configured 503", checkout.status, checkout.json);
      process.exit(1);
    }
    console.log("contract-qa-billing SKIP live checkout (Stripe disabled on host — expected)");
    console.log("billing shape OK", {
      plan: me.json.plan,
      stripeEnabled: b.stripeEnabled,
      canUpgrade: b.canUpgrade,
    });
    return;
  }

  if (me.json.plan === "pro") {
    const portal = await contractApi(base, headers, "/v1/billing/portal", {
      method: "POST",
      body: {},
    });
    if (portal.status === 400 && portal.json?.error === "no_stripe_customer") {
      console.log("contract-qa-billing OK (pro without customer yet — manual plan?)");
      return;
    }
    if (!portal.ok || !portal.json?.url?.startsWith("https://")) {
      console.error("portal failed", portal.status, portal.json);
      process.exit(1);
    }
    console.log("contract-qa-billing OK (portal URL returned, checkout not run)");
    return;
  }

  console.log("contract-qa-billing OK (stripe enabled; use dashboard for paid checkout E2E)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

#!/usr/bin/env node
/** Stripe billing readiness — .dev.vars, price validation, prod /v1/me */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import "./load-env.mjs";
import { apiOrigin, apiUrl } from "./lib/public-origins.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const devVarsPath = join(root, ".dev.vars");
const publicApi = apiOrigin();
const apiKey = process.env.MAILAGENT_API_KEY ?? process.env.API_KEY;

const STRIPE_KEYS = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_PRO"];
const WEBHOOK_URL = apiUrl("/webhooks/stripe");

function parseDevVars(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

async function validatePrice(secret, priceId) {
  const res = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(priceId)}`, {
    headers: { Authorization: `Bearer ${secret.trim()}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, message: data.error?.message ?? `HTTP ${res.status}` };
  if (data.type !== "recurring") return { ok: false, message: "price must be recurring" };
  if (data.unit_amount !== 2900 || data.currency !== "usd" || data.recurring?.interval !== "month") {
    return { ok: false, message: `expected 29.00 USD per month, got ${data.unit_amount / 100} ${data.currency} per ${data.recurring?.interval}` };
  }
  return { ok: true, interval: data.recurring?.interval, currency: data.currency };
}

console.log("MailAgent billing (Stripe) check\n");

console.log("Stripe Dashboard:");
console.log(`  Webhook URL: ${WEBHOOK_URL}`);
console.log("  Events: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted");
console.log("  Customer portal: enable cancel + payment method\n");

const devVars = parseDevVars(devVarsPath);
let localOk = true;

console.log("Local .dev.vars:");
if (!existsSync(devVarsPath)) {
  console.log("  ✗ missing .dev.vars");
  localOk = false;
} else {
  for (const key of STRIPE_KEYS) {
    const ok = Boolean(devVars[key]?.trim());
    if (!ok) localOk = false;
    console.log(`  ${ok ? "✓" : "○"} ${key}${ok ? "" : " (not set — OK until go-live)"}`);
  }
}

if (devVars.STRIPE_SECRET_KEY && devVars.STRIPE_PRICE_PRO) {
  const v = await validatePrice(devVars.STRIPE_SECRET_KEY, devVars.STRIPE_PRICE_PRO);
  console.log(`  ${v.ok ? "✓" : "✗"} price validation${v.ok ? ` (${v.currency}/${v.interval})` : `: ${v.message}`}`);
  if (!v.ok) localOk = false;
}
console.log("");

if (!localOk && !devVars.STRIPE_SECRET_KEY) {
  console.log("Stripe not configured locally (expected until billing launch).");
  console.log("When ready: npm run wizard:stripe");
  console.log("Guide: docs/STRIPE-SETUP.md\n");
}

try {
  const cfg = await fetch(`${publicApi}/v1/upgrade/config`).then((r) => r.json());
  console.log(`Prod self-serve upgrade (/v1/upgrade/config): billing ${cfg.billing === true ? "on" : "off"}\n`);
} catch {
  console.log("Prod /v1/upgrade/config: unreachable\n");
}

if (!apiKey) {
  console.log("ℹ Set MAILAGENT_API_KEY in .env to check prod billing status\n");
  process.exit(0);
}

try {
  const meRes = await fetch(`${publicApi}/v1/me`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const me = await meRes.json().catch(() => ({}));
  if (!meRes.ok) {
    console.error("GET /v1/me failed", meRes.status, me);
    process.exit(1);
  }

  const b = me.billing ?? {};
  console.log("API (this key):");
  console.log(`  plan: ${me.plan}`);
  console.log(`  teamId: ${me.teamId ?? "(legacy key — no Stripe checkout)"}`);
  console.log(`  billing.stripeEnabled: ${b.stripeEnabled}`);
  console.log(`  billing.canUpgrade: ${b.canUpgrade}`);
  console.log(`  billing.canManagePortal: ${b.canManagePortal}`);

  if (!b.stripeEnabled) {
    console.log("\nProd Stripe: disabled (no STRIPE_* on Worker — normal until go-live)");
    console.log("Enable: npm run wizard:stripe -- --deploy\n");
  } else {
    console.log("\nProd Stripe: enabled");
    console.log("Verify: npm run test:contract:qa:billing\n");
  }
} catch (e) {
  console.error("prod check failed", e);
  process.exit(1);
}

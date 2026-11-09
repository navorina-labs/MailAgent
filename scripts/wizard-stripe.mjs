#!/usr/bin/env node
/** Stripe billing wizard — dashboard checklist, .dev.vars merge, optional prod deploy */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawnSync } from "node:child_process";
import { apiUrl, workspaceUrl } from "./lib/public-origins.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const devVarsPath = join(root, ".dev.vars");
const WEBHOOK_URL = apiUrl("/webhooks/stripe");
const STRIPE_KEYS = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_PRO"];

function printSteps() {
  console.log(`
Stripe — Pro subscription (10–15 мин, test mode сначала)

1. https://dashboard.stripe.com → переключи Test mode

2. Product catalog → Add product "MailAgent Pro"
   Recurring price: 29.00 USD, Monthly → скопируй Price ID (price_…)

3. Settings → Billing → Customer portal → включи cancel / payment method

4. Developers → Webhooks → Add endpoint
   URL: ${WEBHOOK_URL}
   Events:
     • checkout.session.completed
     • customer.subscription.updated
     • customer.subscription.deleted
   Signing secret → whsec_…

5. Developers → API keys → Secret key (sk_test_…) или Restricted key (rk_test_…)

Локальный webhook (опционально):
  stripe listen --forward-to http://127.0.0.1:8787/webhooks/stripe

Docs: docs/STRIPE-SETUP.md · ${workspaceUrl("/docs/billing.html")}
`);
}

function parseDevVars(path) {
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
  const map = {};
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    map[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return { lines, map };
}

function mergeDevVars(map) {
  const { lines, map: existing } = parseDevVars(devVarsPath);
  const merged = { ...existing, ...map };
  const kept = lines.filter((line) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return true;
    const i = t.indexOf("=");
    if (i === -1) return true;
    return !STRIPE_KEYS.includes(t.slice(0, i).trim());
  });
  const block = [
    "",
    "# Stripe Pro — wizard-stripe",
    ...STRIPE_KEYS.filter((k) => merged[k]?.trim()).map((k) => `${k}=${merged[k].trim()}`),
  ];
  writeFileSync(devVarsPath, [...kept, ...block].join("\n").replace(/\n+$/, "\n"));
}

async function validatePrice(secret, priceId) {
  const res = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(priceId)}`, {
    headers: { Authorization: `Bearer ${secret.trim()}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error?.message ?? `Stripe prices API ${res.status}`);
  }
  if (data.type !== "recurring") {
    throw new Error(`price ${priceId} must be recurring (subscription)`);
  }
  if (data.unit_amount !== 2900 || data.currency !== "usd" || data.recurring?.interval !== "month") {
    throw new Error(
      `price ${priceId} must be 29.00 USD per month (got ${data.unit_amount / 100} ${data.currency} per ${data.recurring?.interval})`
    );
  }
  return data;
}

async function prompt(rl, label, fallback = "") {
  const hint = fallback ? ` [${fallback.slice(0, 8)}…]` : "";
  const ans = (await rl.question(`${label}${hint}: `)).trim();
  return ans || fallback;
}

async function collect() {
  const fromEnv = Object.fromEntries(
    STRIPE_KEYS.map((k) => [k, process.env[k]?.trim() ?? ""]).filter(([, v]) => v)
  );
  if (fromEnv.STRIPE_SECRET_KEY && fromEnv.STRIPE_WEBHOOK_SECRET && fromEnv.STRIPE_PRICE_PRO) {
    return fromEnv;
  }

  const rl = createInterface({ input, output });
  try {
    const secret = await prompt(rl, "STRIPE_SECRET_KEY");
    const webhook = await prompt(rl, "STRIPE_WEBHOOK_SECRET");
    const price = await prompt(rl, "STRIPE_PRICE_PRO");
    if (!secret || !webhook || !price) {
      console.error("\nНужны все три значения.");
      process.exit(1);
    }
    return {
      STRIPE_SECRET_KEY: secret,
      STRIPE_WEBHOOK_SECRET: webhook,
      STRIPE_PRICE_PRO: price,
    };
  } finally {
    rl.close();
  }
}

const deploy = process.argv.includes("--deploy");

printSteps();

if (!existsSync(devVarsPath)) {
  console.error("Создай .dev.vars из .dev.vars.example, затем запусти снова.\n");
  process.exit(1);
}

const creds = await collect();

try {
  const price = await validatePrice(creds.STRIPE_SECRET_KEY, creds.STRIPE_PRICE_PRO);
  console.log(`\n✓ Price OK: ${price.id} (${price.currency} · ${price.recurring?.interval})`);
} catch (e) {
  console.error("\n✗ Price validation failed:", e instanceof Error ? e.message : e);
  console.error("Проверь STRIPE_SECRET_KEY и STRIPE_PRICE_PRO (test vs live mode).\n");
  process.exit(1);
}

mergeDevVars(creds);
console.log(`\n✓ Записано в ${devVarsPath}`);
console.log("  npm run doctor:billing — проверка\n");

if (!deploy) {
  console.log("Деплой на prod:");
  console.log("  npm run wizard:stripe -- --deploy\n");
  process.exit(0);
}

console.log("→ npm run setup:stripe-prod\n");
const r = spawnSync("npm", ["run", "setup:stripe-prod"], { cwd: root, stdio: "inherit", shell: true });
process.exit(r.status ?? 1);

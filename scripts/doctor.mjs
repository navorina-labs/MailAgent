#!/usr/bin/env node
/** Environment diagnostics: .dev.vars, DB, prod API, webhook; --qa for QA consumers */
import "./load-env.mjs";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { apiOrigin } from "./lib/public-origins.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const requiredDevVars = [
  "DATABASE_URL",
  "RESEND_API_KEY",
  "RESEND_WEBHOOK_SECRET",
  "API_KEY",
  "INBOX_DOMAIN",
];

function parseDevVars(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

const qaMode = process.argv.includes("--qa");

const merged = { ...parseDevVars(join(root, ".dev.vars")), ...process.env };

let ok = true;
const notes = [];

if (qaMode) {
  console.log("MailAgent doctor (--qa consumer)\n");
  const apiUrl = apiOrigin(merged);
  const apiKey = merged.MAILAGENT_API_KEY ?? merged.API_KEY;
  if (!apiKey) {
    console.log("✗ Set MAILAGENT_API_KEY (or API_KEY in .dev.vars)");
    process.exit(1);
  }
  console.log("✓ API key present");
  console.log(`  URL: ${apiUrl}`);

  try {
    const health = await fetch(`${apiUrl}/health`);
    const healthJson = await health.json().catch(() => ({}));
    console.log(health.ok ? "✓" : "✗", "GET /health", health.status, healthJson.webhook ?? "");
    if (!health.ok) ok = false;

    const me = await fetch(`${apiUrl}/v1/me`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const meJson = await me.json().catch(() => ({}));
    console.log(
      me.ok ? "✓" : "✗",
      "GET /v1/me",
      me.ok
        ? `plan=${meJson.plan ?? "?"} active=${meJson.usage?.activeInboxes ?? "?"} outbound=${meJson.capabilities?.outbound?.enabled ?? "?"}`
        : meJson.error
    );
    if (!me.ok) ok = false;

    const agent = await fetch(`${apiUrl}/v1/agent`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const agentJson = await agent.json().catch(() => ({}));
    const tools = agentJson.mcpTools ?? [];
    console.log(
      agent.ok ? "✓" : "✗",
      "GET /v1/agent",
      agent.ok ? `mcpTools=${tools.length} oidc=${agentJson.auth?.oidc ?? "?"}` : agentJson.error
    );
    if (!agent.ok) ok = false;
    if (agent.ok && !tools.includes("mailagent_diagnose_inbox")) {
      console.log("  hint: deploy v0.12+ for mailagent_diagnose_inbox");
    }

    const created = await fetch(`${apiUrl}/v1/inboxes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ label: `doctor-qa-${Date.now()}`, ttlMinutes: 15 }),
    });
    const box = await created.json().catch(() => ({}));
    console.log(created.ok ? "✓" : "✗", "POST /v1/inboxes", created.status, box.id ?? box.error);
    if (!created.ok || !box.id) ok = false;
    else {
      const diagnose = await fetch(`${apiUrl}/v1/inboxes/${box.id}/diagnose`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const diagJson = await diagnose.json().catch(() => ({}));
      console.log(
        diagnose.ok ? "✓" : "✗",
        "GET …/diagnose",
        diagnose.ok
          ? `hints=${diagJson.troubleshooting?.length ?? 0} action=${diagJson.recommendedAction?.type ?? "?"}`
          : diagJson.error
      );
      if (!diagnose.ok) ok = false;

      await fetch(`${apiUrl}/v1/inboxes/${box.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    }
  } catch (e) {
    console.log("✗ API:", e instanceof Error ? e.message : e);
    ok = false;
  }

  console.log(
    ok
      ? "\nReady: npm run smoke:qa | npx @mailagent/qa in your test repo"
      : "\nFix issues above — see docs/QA-ONBOARDING.md"
  );
  process.exit(ok ? 0 : 1);
}

console.log("MailAgent doctor\n");

if (!existsSync(join(root, ".dev.vars"))) {
  console.log("✗ .dev.vars missing — cp .dev.vars.example .dev.vars");
  ok = false;
} else {
  console.log("✓ .dev.vars");
  for (const key of requiredDevVars) {
    const v = merged[key];
    if (
      !v ||
      v.includes("xxx") ||
      v.includes("your-id") ||
      v.includes("YOUR_PASSWORD") ||
      v.includes("placeholder")
    ) {
      console.log(`  ✗ ${key}`);
      ok = false;
    } else {
      console.log(`  ✓ ${key}`);
    }
  }
}

if (!existsSync(join(root, "mcp/dist/index.js"))) {
  console.log("✗ MCP not built — npm run build:mcp");
  ok = false;
} else {
  console.log("✓ mcp/dist");
}

if (merged.DATABASE_URL && !merged.DATABASE_URL.includes("placeholder")) {
  try {
    const sql = neon(merged.DATABASE_URL);
    await sql`SELECT 1`;
    console.log("✓ DATABASE_URL connects");

    const migDir = join(root, "migrations");
    const files = readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
    const latest = files[files.length - 1];
    const tableCheck = await sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'message_attachments'
      ) AS ok
    `;
    const hasAtt = tableCheck[0]?.ok;
    if (latest?.startsWith("010") && !hasAtt) {
      console.log("✗ schema behind — run: npm run db:migrate");
      ok = false;
    } else {
      console.log(`✓ migrations (latest file: ${latest})`);
    }
  } catch (e) {
    console.log("✗ DATABASE_URL:", e instanceof Error ? e.message : e);
    ok = false;
  }
} else {
  notes.push("Skip DB check (no DATABASE_URL)");
}

const apiUrl = apiOrigin(merged);
const apiKey = merged.MAILAGENT_API_KEY ?? merged.API_KEY;

if (merged.RESEND_API_KEY && !merged.RESEND_API_KEY.includes("xxx")) {
  try {
    const res = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${merged.RESEND_API_KEY}` },
    });
    console.log(
      res.ok ? "✓" : "✗",
      "Resend API (GET /domains)",
      res.status,
      res.ok ? "key valid" : await res.text().then((t) => t.slice(0, 80))
    );
    if (!res.ok) ok = false;
  } catch (e) {
    console.log("✗ Resend API:", e instanceof Error ? e.message : e);
    ok = false;
  }
} else {
  notes.push("Skip Resend ping (no RESEND_API_KEY)");
}

if (apiKey) {
  try {
    const health = await fetch(`${apiUrl}/health`);
    const healthJson = await health.json().catch(() => ({}));
    console.log(
      health.ok ? "✓" : "✗",
      `GET ${apiUrl}/health`,
      health.status,
      healthJson.webhook ?? ""
    );
    if (!health.ok) ok = false;

    const me = await fetch(`${apiUrl}/v1/me`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const meJson = await me.json().catch(() => ({}));
    console.log(
      me.ok ? "✓" : "✗",
      "GET /v1/me",
      me.ok ? `activeInboxes=${meJson.usage?.activeInboxes ?? "?"}` : meJson.error
    );
    if (!me.ok) ok = false;
  } catch (e) {
    console.log("✗ API check failed:", e instanceof Error ? e.message : e);
    ok = false;
  }
} else {
  notes.push("Skip API check (set MAILAGENT_API_KEY or API_KEY)");
}

console.log("\nResend inbound webhook (prod/local):");
console.log(`  POST ${apiUrl}/webhooks/resend`);
console.log("  Resend Dashboard → Webhooks → email.received");

if (notes.length) {
  console.log("\nNotes:");
  for (const n of notes) console.log(`  • ${n}`);
}

console.log(
  ok
    ? "\nReady: npm run dev | npm run smoke:qa"
    : "\nFix issues above, then: npm run doctor"
);
process.exit(ok ? 0 : 1);

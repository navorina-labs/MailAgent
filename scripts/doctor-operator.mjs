#!/usr/bin/env node
/** Prod operator gaps — what you can enable without Stripe (OUTBOUND, OIDC, CI secrets) */
import "./load-env.mjs";
import { apiOrigin } from "./lib/public-origins.mjs";

const apiUrl = apiOrigin();
const apiKey = process.env.MAILAGENT_API_KEY ?? process.env.API_KEY;
const resendKey = process.env.RESEND_API_KEY;

console.log("MailAgent operator check (Stripe skipped)\n");
console.log(`API: ${apiUrl}\n`);

const tasks = [];

if (!apiKey) {
  console.log("✗ Set MAILAGENT_API_KEY in .env (same as prod API_KEY)\n");
  tasks.push({
    id: "api-key-local",
    title: "Local .env",
    cmd: 'grep MAILAGENT_API_KEY .env || echo "MAILAGENT_API_KEY=..." >> .env',
  });
  process.exit(1);
}

console.log("✓ API key in env\n");

try {
  const meRes = await fetch(`${apiUrl}/v1/me`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const me = await meRes.json().catch(() => ({}));
  if (!meRes.ok) {
    console.log("✗ GET /v1/me", meRes.status, me.error ?? me);
    process.exit(1);
  }

  const outbound = me.capabilities?.outbound ?? {};
  console.log("Outbound (send/reply):");
  console.log(`  enabled:       ${outbound.enabled ?? "?"}`);
  console.log(`  verifiedFrom:  ${outbound.verifiedFrom ?? "?"}`);
  if (outbound.hint) console.log(`  hint:          ${outbound.hint}`);

  if (!outbound.verifiedFrom) {
    tasks.push({
      id: "outbound-from",
      title: "Enable outbound From address",
      steps: [
        "Resend → Domains → verify DNS (SPF/DKIM)",
        "npx wrangler secret put OUTBOUND_FROM",
        "# e.g. noreply@navorina.ai",
        "Re-run: npm run doctor:operator",
      ],
      doc: "docs/YOUR-TURN.md#outbound",
    });
  } else {
    console.log("  ✓ OUTBOUND_FROM active on prod\n");
  }

  const agentRes = await fetch(`${apiUrl}/v1/agent`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const agent = await agentRes.json().catch(() => ({}));
  const oidc = agent.auth?.oidc ?? "disabled";
  console.log("OIDC (browser login for MCP):");
  console.log(`  status: ${oidc}`);

  if (oidc === "disabled") {
    tasks.push({
      id: "oidc",
      title: "Enable OIDC on prod (optional)",
      steps: [
        "npm run doctor:oidc",
        "Auth0 → Regular Web App → callbacks (see doctor output)",
        "Add OIDC_* to .dev.vars",
        "npm run setup:oidc-prod",
      ],
      doc: "docs/MCP-OAUTH-IDP.md",
    });
  } else {
    console.log("  ✓ OIDC enabled");
    console.log("  rotate secret: Auth0 → Settings → Rotate → npm run setup:oidc-prod\n");
  }

  console.log(`Agent API: v${agent.version ?? "?"} · MCP tools: ${agent.mcpTools?.length ?? "?"}\n`);
} catch (e) {
  console.log("✗ API:", e instanceof Error ? e.message : e);
  process.exit(1);
}

if (resendKey && !resendKey.includes("xxx")) {
  try {
    const domRes = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${resendKey}` },
    });
    const domJson = await domRes.json().catch(() => ({}));
    const domains = domJson.data ?? [];
    console.log(`Resend domains: ${domains.length} (free tier often ≤2)`);
    for (const d of domains.slice(0, 8)) {
      console.log(`  • ${d.name} — ${d.status}`);
    }
    if (domains.length >= 2) {
      tasks.push({
        id: "resend-domains",
        title: "Resend domain quota (contract-qa-domains skips if full)",
        steps: [
          "Delete unused domains in Resend dashboard",
          "Or upgrade Resend plan",
        ],
      });
    }
    console.log("");
  } catch {
    console.log("ℹ Resend domain list skipped\n");
  }
}

tasks.push({
  id: "github-secrets",
  title: "GitHub Actions secrets (verify in repo Settings)",
  steps: [
    "CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID — deploy",
    "MAILAGENT_API_KEY — test:prod:gate on deploy (same key as .env)",
    "DATABASE_URL — optional auto-migrate on deploy",
  ],
  doc: "docs/OPERATOR.md",
});

console.log("On hold (skip for now):");
console.log("  • Stripe — npm run wizard:stripe (when account ready)\n");

if (tasks.length === 0) {
  console.log("All operator items look done.");
  process.exit(0);
}

console.log("Your turn — open tasks:\n");
for (const t of tasks) {
  console.log(`── ${t.title} ──`);
  if (t.doc) console.log(`   doc: ${t.doc}`);
  for (const s of t.steps) console.log(`   ${s}`);
  console.log("");
}

console.log("Full guide: docs/YOUR-TURN.md");
process.exit(0);

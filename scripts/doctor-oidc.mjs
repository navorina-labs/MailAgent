#!/usr/bin/env node
/** OIDC readiness — .dev.vars, Auth0 checklist, prod status */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import "./load-env.mjs";
import { apiOrigin, apiUrl } from "./lib/public-origins.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const devVarsPath = join(root, ".dev.vars");
const publicApi = apiOrigin();
const apiKey = process.env.MAILAGENT_API_KEY ?? process.env.API_KEY;

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

const required = ["OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"];
const devVars = parseDevVars(devVarsPath);
const missingLocal = required.filter((k) => !devVars[k]?.trim());

console.log("MailAgent OIDC check\n");

console.log("Auth0 app (Regular Web Application):");
console.log("  Allowed Callback URLs:");
console.log(`    ${apiUrl("/v1/oauth/callback")}`);
console.log("    http://127.0.0.1:8787/v1/oauth/callback");
console.log("  OIDC Issuer = Auth0 Domain (https://TENANT.us.auth0.com)\n");

console.log("Local .dev.vars:");
if (!existsSync(devVarsPath)) {
  console.log("  ✗ missing .dev.vars — copy from .dev.vars.example\n");
} else {
  for (const key of required) {
    const ok = Boolean(devVars[key]?.trim());
    console.log(`  ${ok ? "✓" : "✗"} ${key}${ok ? "" : " (empty)"}`);
  }
  if (devVars.OIDC_AUDIENCE?.trim()) console.log("  ✓ OIDC_AUDIENCE (optional)");
  console.log("");
}

if (missingLocal.length) {
  console.log("Add to .dev.vars (see .dev.vars.example):");
  console.log("  OIDC_ISSUER=https://YOUR-TENANT.us.auth0.com");
  console.log("  OIDC_CLIENT_ID=...");
  console.log("  OIDC_CLIENT_SECRET=...");
  console.log("\nThen: npm run wizard:auth0 -- --deploy");
  console.log("  (or: npm run setup:oidc-prod after filling .dev.vars)");
  console.log("Guide: docs/MCP-OAUTH-IDP.md · docs/oauth-idp.html\n");
}

if (!apiKey) {
  console.log("ℹ Set MAILAGENT_API_KEY in .env to check prod status\n");
  process.exit(missingLocal.length ? 1 : 0);
}

try {
  const agentRes = await fetch(`${publicApi}/v1/agent`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const agent = await agentRes.json().catch(() => ({}));
  const oidc = agent.auth?.oidc ?? "disabled";
  console.log("Prod:");
  console.log(`  auth.oidc: ${oidc}`);

  if (oidc === "enabled") {
    const meta = await fetch(`${publicApi}/.well-known/oauth-authorization-server`).then((r) =>
      r.json().catch(() => ({}))
    );
    console.log(`  authorization_endpoint: ${meta.authorization_endpoint ? "yes" : "no"}`);
    console.log("\nVerify: npm run test:contract:qa:oidc\n");
    process.exit(0);
  }

  if (missingLocal.length === 0) {
    console.log("\n  Local vars OK — run: npm run setup:oidc-prod\n");
  } else {
    console.log("\n  Prod OIDC still disabled until secrets are on Worker.\n");
  }
} catch (e) {
  console.log("✗ prod check:", e instanceof Error ? e.message : e);
}

process.exit(missingLocal.length ? 1 : 0);

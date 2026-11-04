#!/usr/bin/env node
/** Push GOOGLE_* from .dev.vars to Cloudflare Worker secrets, then print Gmail connect URL */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import "./load-env.mjs";
import { apiOrigin, workspaceUrl } from "./lib/public-origins.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const devVars = join(root, ".dev.vars");
const envFile = join(root, ".env");
const PROD_API = apiOrigin();

function parse(path) {
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

const vars = { ...parse(devVars), ...parse(envFile), ...process.env };
const clientId = vars.GOOGLE_CLIENT_ID?.trim() || vars.GMAIL_CLIENT_ID?.trim();
const clientSecret =
  vars.GOOGLE_CLIENT_SECRET?.trim() || vars.GMAIL_CLIENT_SECRET?.trim();

if (!clientId || !clientSecret) {
  console.error("Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .dev.vars");
  console.error("\nRun: npm run wizard:workspace-gmail");
  console.error("Guide: docs/WORKSPACE-GMAIL-SETUP.md");
  process.exit(1);
}

for (const [key, val] of [
  ["GOOGLE_CLIENT_ID", clientId],
  ["GOOGLE_CLIENT_SECRET", clientSecret],
]) {
  console.log(`→ wrangler secret put ${key}`);
  execSync(`npx wrangler secret put ${key}`, {
    cwd: root,
    input: val,
    stdio: ["pipe", "inherit", "inherit"],
  });
}

console.log("\n✓ Secrets uploaded. Waiting for Worker propagation…");
await new Promise((r) => setTimeout(r, 3000));

const apiKey = vars.MAILAGENT_API_KEY?.trim() || vars.API_KEY?.trim();
if (!apiKey) {
  console.log("\nVerify:");
  console.log(`  curl -sS ${PROD_API}/v1/workspace/gmail/status \\`);
  console.log('    -H "Authorization: Bearer $MAILAGENT_API_KEY" | jq');
  console.log("\nConnect Gmail:");
  console.log(`  curl -sS ${PROD_API}/v1/workspace/gmail/connect \\`);
  console.log('    -H "Authorization: Bearer $MAILAGENT_API_KEY" | jq .url');
  process.exit(0);
}

const statusRes = await fetch(`${PROD_API}/v1/workspace/gmail/status`, {
  headers: { Authorization: `Bearer ${apiKey}` },
});
const status = await statusRes.json();
console.log("\nGmail status:", status);

if (!status.configured) {
  console.error("\nWorker ещё не видит secrets — подожди ~30s и повтори connect.");
  process.exit(1);
}

const connectRes = await fetch(`${PROD_API}/v1/workspace/gmail/connect`, {
  headers: { Authorization: `Bearer ${apiKey}` },
});
const connect = await connectRes.json();
if (!connectRes.ok || !connect.url) {
  console.error("Connect failed:", connect);
  process.exit(1);
}

console.log("\n✓ Gmail OAuth готов. Открой в браузере:\n");
console.log(connect.url);
console.log(`\nИли в UI: ${workspaceUrl("/workspace.html")}`);
console.log(`Redirect URI: ${connect.redirectUri}`);

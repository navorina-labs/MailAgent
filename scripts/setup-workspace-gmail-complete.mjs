#!/usr/bin/env node
/** Full Workspace Gmail/Calendar setup: secrets → redirect URIs → connect URLs */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import "./load-env.mjs";
import { apiOrigin } from "./lib/public-origins.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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

const vars = { ...parse(join(root, ".dev.vars")), ...parse(join(root, ".env")), ...process.env };
const api = apiOrigin(vars);
const apiKey = vars.MAILAGENT_API_KEY?.trim() || vars.API_KEY?.trim();

const clientId = vars.GOOGLE_CLIENT_ID?.trim() || vars.GMAIL_CLIENT_ID?.trim();
const clientSecret =
  vars.GOOGLE_CLIENT_SECRET?.trim() || vars.GMAIL_CLIENT_SECRET?.trim();

if (!clientId || !clientSecret) {
  console.error("Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET");
  process.exit(1);
}

console.log("1/4 → wrangler secrets");
for (const [key, val] of [
  ["GOOGLE_CLIENT_ID", clientId],
  ["GOOGLE_CLIENT_SECRET", clientSecret],
]) {
  console.log(`   ${key}`);
  spawnSync("npx", ["wrangler", "secret", "put", key], {
    cwd: root,
    input: val,
    stdio: ["pipe", "inherit", "inherit"],
  });
}

console.log("\n2/4 → Google Console redirect URIs (Playwright)");
const patch = spawnSync("node", ["scripts/patch-google-oauth-redirects.mjs"], {
  cwd: root,
  stdio: "inherit",
});
if (patch.status !== 0) {
  console.error("\nRedirect URI patch failed — fix in Console, then rerun connect step.");
}

console.log("\n3/4 → wait propagation");
await new Promise((r) => setTimeout(r, 5000));

if (!apiKey) {
  console.log("\n4/4 → set MAILAGENT_API_KEY and open connect URLs manually");
  process.exit(patch.status ?? 0);
}

const headers = { Authorization: `Bearer ${apiKey}` };

async function check(path) {
  const r = await fetch(`${api}${path}`, { headers });
  return { status: r.status, body: await r.json() };
}

const gmailStatus = await check("/v1/workspace/gmail/status");
console.log("\n4/4 → status", gmailStatus.body?.configured ? "configured" : gmailStatus.body);

for (const [label, path] of [
  ["Gmail", "/v1/workspace/gmail/connect"],
  ["Calendar", "/v1/workspace/calendar/connect"],
]) {
  const r = await fetch(`${api}${path}`, { headers });
  const body = await r.json();
  if (body.url) {
    console.log(`\n${label} — открой в браузере и подтверди доступ:\n${body.url}`);
  } else {
    console.log(`\n${label} connect failed:`, body);
  }
}

const accounts = await check("/v1/workspace/gmail/accounts");
console.log("\nGmail accounts:", accounts.body?.count ?? accounts.body);

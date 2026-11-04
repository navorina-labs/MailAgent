#!/usr/bin/env node
/** Auth0 OIDC wizard — dashboard checklist, .dev.vars merge, optional prod deploy */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawnSync } from "node:child_process";
import { apiUrl, workspaceUrl } from "./lib/public-origins.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const devVarsPath = join(root, ".dev.vars");
const CALLBACKS = [
  apiUrl("/v1/oauth/callback"),
  "http://127.0.0.1:8787/v1/oauth/callback",
];

const OIDC_KEYS = ["OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_AUDIENCE"];

function printSteps() {
  console.log(`
Auth0 — создай Regular Web Application (5 мин)

1. https://manage.auth0.com → Applications → Create Application
   Name: MailAgent MCP
   Type: Regular Web Application

2. Settings → Allowed Callback URLs (вставь обе строки через запятую):
   ${CALLBACKS.join("\n   ")}

3. Сохрани (Save Changes)

4. Скопируй с той же страницы:
   • Domain          → OIDC_ISSUER = https://<DOMAIN>
   • Client ID       → OIDC_CLIENT_ID
   • Client Secret   → OIDC_CLIENT_SECRET
   (OIDC_AUDIENCE — опционально, для Auth0 API)

Docs: docs/MCP-OAUTH-IDP.md · ${workspaceUrl("/docs/oauth-idp.html")}
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
    return !OIDC_KEYS.includes(t.slice(0, i).trim());
  });
  const oidcBlock = [
    "",
    "# OIDC (Auth0) — wizard-auth0-oidc",
    ...OIDC_KEYS.filter((k) => merged[k]?.trim()).map((k) => `${k}=${merged[k].trim()}`),
  ];
  writeFileSync(devVarsPath, [...kept, ...oidcBlock].join("\n").replace(/\n+$/, "\n"));
}

function normalizeIssuer(raw) {
  let v = raw.trim().replace(/\/$/, "");
  if (!v.startsWith("http")) v = `https://${v}`;
  return v;
}

async function prompt(rl, label, fallback = "") {
  const hint = fallback ? ` [${fallback}]` : "";
  const ans = (await rl.question(`${label}${hint}: `)).trim();
  return ans || fallback;
}

async function collect() {
  const fromEnv = Object.fromEntries(
    OIDC_KEYS.map((k) => [k, process.env[k]?.trim() ?? ""]).filter(([, v]) => v)
  );
  if (fromEnv.OIDC_ISSUER && fromEnv.OIDC_CLIENT_ID && fromEnv.OIDC_CLIENT_SECRET) {
    return { ...fromEnv, OIDC_ISSUER: normalizeIssuer(fromEnv.OIDC_ISSUER) };
  }

  const rl = createInterface({ input, output });
  try {
    const issuer = normalizeIssuer(await prompt(rl, "OIDC_ISSUER (Auth0 Domain)"));
    const clientId = await prompt(rl, "OIDC_CLIENT_ID");
    const clientSecret = await prompt(rl, "OIDC_CLIENT_SECRET");
    const audience = await prompt(rl, "OIDC_AUDIENCE (optional, Enter to skip)");
    if (!issuer || !clientId || !clientSecret) {
      console.error("\nНужны issuer, client id и secret.");
      process.exit(1);
    }
    return {
      OIDC_ISSUER: issuer,
      OIDC_CLIENT_ID: clientId,
      OIDC_CLIENT_SECRET: clientSecret,
      ...(audience ? { OIDC_AUDIENCE: audience } : {}),
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
mergeDevVars(creds);
console.log(`\n✓ Записано в ${devVarsPath}`);
console.log("  npm run doctor:oidc — проверка локально\n");

if (!deploy) {
  console.log("Деплой на prod:");
  console.log("  npm run wizard:auth0 -- --deploy\n");
  process.exit(0);
}

console.log("→ npm run setup:oidc-prod\n");
const r = spawnSync("npm", ["run", "setup:oidc-prod"], { cwd: root, stdio: "inherit", shell: true });
process.exit(r.status ?? 1);

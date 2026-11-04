#!/usr/bin/env node
/** Google Gmail OAuth wizard — Cloud Console checklist, .dev.vars merge, optional prod deploy */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawnSync } from "node:child_process";
import "./load-env.mjs";
import { apiOrigin } from "./lib/public-origins.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const devVarsPath = join(root, ".dev.vars");
const PROD_API = apiOrigin();
const customApi = (process.env.MAILAGENT_API_URL || "").replace(/\/$/, "");

const GMAIL_CALLBACKS = [
  `${PROD_API}/v1/workspace/gmail/callback`,
  "http://127.0.0.1:8787/v1/workspace/gmail/callback",
];
const CALENDAR_CALLBACKS = [
  `${PROD_API}/v1/workspace/calendar/callback`,
  "http://127.0.0.1:8787/v1/workspace/calendar/callback",
];
if (customApi.startsWith("http") && customApi !== PROD_API) {
  GMAIL_CALLBACKS.unshift(`${customApi}/v1/workspace/gmail/callback`);
  CALENDAR_CALLBACKS.unshift(`${customApi}/v1/workspace/calendar/callback`);
}

const OAUTH_KEYS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];

function printSteps() {
  console.log(`
Google Cloud — OAuth для Workspace Gmail (10 мин)

1. https://console.cloud.google.com/apis/credentials
   → Create Credentials → OAuth client ID → Web application
   Name: MailAgent Workspace

2. Authorized redirect URIs (добавь все):
   Gmail:
   ${GMAIL_CALLBACKS.join("\n   ")}
   Calendar (optional, P2/P3):
   ${CALENDAR_CALLBACKS.join("\n   ")}

3. APIs & Services → Library → включи:
   • Gmail API
   • Google Calendar API (optional)

4. OAuth consent screen → External → добавь scopes:
   • .../auth/gmail.readonly
   • .../auth/gmail.compose (drafts, P3)
   • .../auth/calendar.readonly
   • .../auth/calendar.events

5. Скопируй Client ID и Client Secret сюда.

Docs: docs/WORKSPACE-GMAIL-SETUP.md
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
    return !OAUTH_KEYS.includes(t.slice(0, i).trim());
  });
  const block = [
    "",
    "# Workspace Gmail OAuth — wizard-workspace-gmail",
    ...OAUTH_KEYS.filter((k) => merged[k]?.trim()).map((k) => `${k}=${merged[k].trim()}`),
  ];
  writeFileSync(devVarsPath, [...kept, ...block].join("\n").replace(/\n+$/, "\n"));
}

async function prompt(rl, label, fallback = "") {
  const hint = fallback ? ` [${fallback}]` : "";
  const ans = (await rl.question(`${label}${hint}: `)).trim();
  return ans || fallback;
}

async function collect() {
  const fromEnv = Object.fromEntries(
    OAUTH_KEYS.map((k) => [k, process.env[k]?.trim() ?? ""]).filter(([, v]) => v)
  );
  if (fromEnv.GOOGLE_CLIENT_ID && fromEnv.GOOGLE_CLIENT_SECRET) {
    return fromEnv;
  }

  const rl = createInterface({ input, output });
  try {
    const clientId = await prompt(rl, "GOOGLE_CLIENT_ID");
    const clientSecret = await prompt(rl, "GOOGLE_CLIENT_SECRET");
    if (!clientId || !clientSecret) {
      console.error("\nНужны Client ID и Client Secret.");
      process.exit(1);
    }
    return { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret };
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

if (!deploy) {
  console.log("\nДеплой secrets на prod:");
  console.log("  npm run wizard:workspace-gmail -- --deploy\n");
  process.exit(0);
}

console.log("→ npm run setup:workspace-gmail-prod\n");
const r = spawnSync("npm", ["run", "setup:workspace-gmail-prod"], {
  cwd: root,
  stdio: "inherit",
  shell: true,
});
process.exit(r.status ?? 1);

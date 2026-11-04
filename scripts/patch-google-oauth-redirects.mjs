#!/usr/bin/env node
/** Add MailAgent redirect URIs to Google OAuth client (Playwright, isolated Chrome profile). */
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { apiUrl } from "./lib/public-origins.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT_SUFFIX =
  "1036502699364-d84chbsht5iv9re8ui4j2cpg4l5md5s9.apps.googleusercontent.com";
const PROJECT = "navorina";
const PROFILE = join(homedir(), ".mailagent-gcp-oauth-profile");

const REDIRECTS = [
  apiUrl("/v1/workspace/gmail/callback"),
  apiUrl("/v1/workspace/calendar/callback"),
  "https://mailagent.alex-young33rd.workers.dev/v1/workspace/gmail/callback",
  "https://mailagent.alex-young33rd.workers.dev/v1/workspace/calendar/callback",
  "http://127.0.0.1:8787/v1/workspace/gmail/callback",
  "http://127.0.0.1:8787/v1/workspace/calendar/callback",
];

function apiBaseFromEnv() {
  for (const file of [".env", ".dev.vars"]) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      if (t.startsWith("MAILAGENT_API_URL=")) {
        const base = t.slice("MAILAGENT_API_URL=".length).trim().replace(/\/$/, "");
        if (base.startsWith("http")) {
          REDIRECTS.unshift(
            `${base}/v1/workspace/gmail/callback`,
            `${base}/v1/workspace/calendar/callback`
          );
        }
      }
    }
  }
  return [...new Set(REDIRECTS)];
}

const redirects = apiBaseFromEnv();
const editUrl = `https://console.cloud.google.com/apis/credentials/oauthclient/${CLIENT_SUFFIX}?project=${PROJECT}`;

mkdirSync(PROFILE, { recursive: true });

console.log("Redirect URIs to ensure:");
for (const u of redirects) console.log("  •", u);
console.log(`\nChrome profile: ${PROFILE}`);
console.log("Если попросит логин — войди как alex.young33rd@gmail.com\n");

const context = await chromium.launchPersistentContext(PROFILE, {
  channel: "chrome",
  headless: false,
  viewport: { width: 1280, height: 900 },
});

const page = context.pages()[0] ?? (await context.newPage());
await page.goto(editUrl, { waitUntil: "domcontentloaded", timeout: 180_000 });

// Login or SPA load
for (let i = 0; i < 24; i++) {
  const url = page.url();
  if (url.includes("console.cloud.google.com") && !url.includes("accounts.google.com")) break;
  await page.waitForTimeout(5000);
}

await page.waitForTimeout(3000);

async function collectRedirectInputs() {
  return page.locator(
    'input[aria-label*="redirect" i], input[placeholder*="redirect" i], input[name*="redirect" i]'
  );
}

let inputs = await collectRedirectInputs();
let count = await inputs.count();

if (count === 0) {
  // GCP sometimes nests under "Authorized redirect URIs" section
  const section = page.getByText(/authorized redirect uris/i).first();
  if (await section.isVisible().catch(() => false)) {
    await section.click().catch(() => {});
    await page.waitForTimeout(1000);
    inputs = await collectRedirectInputs();
    count = await inputs.count();
  }
}

if (count === 0) {
  console.error("\nНе удалось найти поля redirect URI на странице:", page.url());
  console.error("Добавь URIs вручную (список выше) и нажми Save.");
  await page.waitForTimeout(180_000);
  await context.close();
  process.exit(1);
}

const existing = new Set();
for (let i = 0; i < count; i++) {
  const val = (await inputs.nth(i).inputValue()).trim();
  if (val) existing.add(val);
}

let added = 0;
for (const uri of redirects) {
  if (existing.has(uri)) continue;
  const addBtn = page.getByRole("button", { name: /add uri/i }).first();
  if (await addBtn.isVisible().catch(() => false)) {
    await addBtn.click();
    await page.waitForTimeout(400);
    inputs = await collectRedirectInputs();
  }
  const target = inputs.last();
  await target.fill(uri);
  existing.add(uri);
  added++;
  console.log("✓ added", uri);
}

if (added > 0) {
  const save = page.getByRole("button", { name: /^save$/i }).first();
  await save.waitFor({ state: "visible", timeout: 30_000 });
  await save.click();
  await page.waitForTimeout(4000);
  console.log("\n✓ Saved in Google Cloud Console");
} else {
  console.log("\n✓ Все redirect URIs уже настроены");
}

await context.close();

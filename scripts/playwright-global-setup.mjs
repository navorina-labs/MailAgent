#!/usr/bin/env node
/**
 * Playwright globalSetup: inbox + simulate attachment → .mailagent-context.json
 * Requires: MAILAGENT_API_KEY, DATABASE_URL, MAILAGENT_API_URL (optional)
 */
import "./load-env.mjs";
import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apiOrigin } from "./lib/public-origins.mjs";

const base = apiOrigin();
const apiKey = process.env.MAILAGENT_API_KEY ?? process.env.API_KEY;
const dbUrl = process.env.DATABASE_URL;
const outPath =
  process.env.MAILAGENT_PW_CONTEXT ??
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "examples/playwright/.mailagent-context.json");

if (!apiKey || !dbUrl) {
  console.error("playwright-global-setup: need MAILAGENT_API_KEY + DATABASE_URL");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json",
};

const label = `pw-setup-${Date.now()}`;
const attachName = "playwright-fixture.pdf";

const created = await fetch(`${base}/v1/inboxes`, {
  method: "POST",
  headers,
  body: JSON.stringify({ label, ttlMinutes: 30, service: "github" }),
});
const inbox = await created.json();
if (!created.ok || !inbox.id) {
  console.error("create inbox failed", created.status, inbox);
  process.exit(1);
}

const simScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "simulate-inbound.mjs");
const sim = spawnSync(
  process.execPath,
  [
    simScript,
    inbox.id,
    "554433",
    "billing@example.com",
    `--subject=PW attachment ${attachName}`,
    `--with-attachment=${attachName}`,
  ],
  { env: process.env, stdio: "inherit" }
);
if (sim.status !== 0) process.exit(sim.status ?? 1);

const wait = await fetch(
  `${base}/v1/inboxes/${inbox.id}/wait?timeout=30&subjectContains=PW attachment`,
  { headers: { Authorization: `Bearer ${apiKey}` } }
);
const waited = await wait.json();
const messageId = waited.message?.id;
if (!wait.ok || !messageId) {
  console.error("wait failed", wait.status, waited);
  await fetch(`${base}/v1/inboxes/${inbox.id}`, { method: "DELETE", headers }).catch(() => {});
  process.exit(1);
}

const ctx = {
  inboxId: inbox.id,
  address: inbox.address,
  messageId,
  attachmentFilename: attachName,
  createdAt: new Date().toISOString(),
};

writeFileSync(outPath, JSON.stringify(ctx, null, 2));
console.log("playwright-global-setup OK →", outPath, ctx);

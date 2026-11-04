#!/usr/bin/env node
/** QA pilot wizard — validate API key, doctor:qa, smoke:qa, print next steps */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import "./load-env.mjs";
import { apiOrigin, workspaceUrl } from "./lib/public-origins.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const apiUrl = apiOrigin();
const apiKey = process.env.MAILAGENT_API_KEY ?? process.env.API_KEY;

console.log("MailAgent QA pilot wizard\n");
console.log(`API: ${apiUrl}\n`);

if (!apiKey) {
  console.error("✗ Set MAILAGENT_API_KEY in .env or environment");
  console.log(`\nGet a key: ${workspaceUrl("/dashboard.html")}`);
  console.log("Guide: docs/QA-PILOT.md");
  process.exit(1);
}

console.log("✓ API key in env\n");

function run(label, cmd, args) {
  console.log(`── ${label} ──`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", env: process.env });
  if (r.status !== 0) {
    console.error(`\n✗ ${label} failed`);
    process.exit(r.status ?? 1);
  }
  console.log("");
}

run("doctor:qa", "npm", ["run", "doctor:qa"]);
run("smoke:qa", "npm", ["run", "smoke:qa"]);

console.log("QA pilot baseline OK\n");
console.log("Next steps:");
console.log("  1. Copy examples/qa-pilot-starter/ → your test repo (Playwright + GH Actions)");
console.log("  2. Set MAILAGENT_API_KEY secret · npm test");
console.log("  3. Label convention: ci-$GITHUB_RUN_ID");
console.log(`  4. Full guide: docs/QA-PILOT.md · ${workspaceUrl("/docs/qa.html")}`);
console.log("  5. Onboard external team: npm run wizard:qa-pilot:onboard · docs/PILOT-ONBOARD.md");

#!/usr/bin/env node
/** Operator wizard — smoke baseline + pilot package for external team onboarding */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import "./load-env.mjs";
import { apiOrigin, workspaceUrl } from "./lib/public-origins.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const apiUrl = apiOrigin();

const args = process.argv.slice(2);
const issueKeyIdx = args.indexOf("--issue-key");
const pilotSlug =
  issueKeyIdx >= 0 ? args[issueKeyIdx + 1] : args.find((a) => !a.startsWith("-"));
const issueKey = issueKeyIdx >= 0;

const apiKey = process.env.MAILAGENT_API_KEY ?? process.env.API_KEY;

console.log("MailAgent QA pilot onboard (operator)\n");
console.log(`API: ${apiUrl}`);
console.log("Guide: docs/PILOT-ONBOARD.md\n");

function run(label, cmd, runArgs) {
  console.log(`── ${label} ──`);
  const r = spawnSync(cmd, runArgs, { cwd: root, stdio: "inherit", env: process.env });
  if (r.status !== 0) {
    console.error(`\n✗ ${label} failed`);
    process.exit(r.status ?? 1);
  }
  console.log("");
}

if (issueKey) {
  if (!process.env.DATABASE_URL) {
    console.error("✗ --issue-key needs DATABASE_URL in .env");
    process.exit(1);
  }
  if (!pilotSlug) {
    console.error("Usage: npm run wizard:qa-pilot:onboard -- --issue-key <pilot-slug>");
    process.exit(1);
  }
  run("issue:pilot-key", "npm", ["run", "issue:pilot-key", "--", pilotSlug]);
}

if (!apiKey) {
  console.error("✗ Set MAILAGENT_API_KEY for smoke (or use key from issue:pilot-key above)");
  console.log("  export MAILAGENT_API_KEY=ma_…");
  process.exit(1);
}

run("doctor:qa", "npm", ["run", "doctor:qa"]);
run("smoke:qa", "npm", ["run", "smoke:qa"]);
run("test:qa-pilot-starter", "npm", ["run", "test:qa-pilot-starter"]);
run("test:qa-pilot-cypress-starter", "npm", ["run", "test:qa-pilot-cypress-starter"]);

console.log("═".repeat(60));
console.log("Pilot package — copy to external team (see docs/PILOT-ONBOARD.md)");
console.log("═".repeat(60));
console.log(`
Starter:  https://github.com/navorinaai/navorina/tree/main/agents-os/agents/mail-agent/examples/qa-pilot-starter
Cypress:  https://github.com/navorinaai/navorina/tree/main/agents-os/agents/mail-agent/examples/qa-pilot-cypress-starter
Docs:     ${workspaceUrl("/docs/qa.html")}

Their steps:
  1. cp -R examples/qa-pilot-starter → their repo
  2. .env → MAILAGENT_API_KEY (send scoped key separately)
  3. npm install && npm test
  4. GH secret MAILAGENT_API_KEY → push PR

Conventions: label ci-$GITHUB_RUN_ID · service preset · docs/PILOT-ONBOARD.md#feedback
`);
console.log("Onboard baseline OK\n");

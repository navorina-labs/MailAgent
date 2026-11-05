#!/usr/bin/env node
/** Security baseline — policy files, npm audit, GitHub secret scanning (no operator secrets) */
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function ok(msg) {
  console.log(`✓ ${msg}`);
}

function fail(msg) {
  failures.push(msg);
  console.log(`✗ ${msg}`);
}

function requireFile(rel) {
  if (existsSync(join(root, rel))) ok(rel);
  else fail(`missing ${rel}`);
}

console.log("MailAgent security baseline\n");

console.log("Policy & trust docs:");
for (const f of [
  "SECURITY.md",
  "docs/SOC2.md",
  "docs/OPERATOR-ACCESS.md",
  "docs/PENTEST-PREP.md",
  "public/privacy.html",
  "public/terms.html",
  "public/docs/security.html",
  "public/docs/sla.html",
]) {
  requireFile(f);
}

console.log("\nCodex plugin:");
requireFile("examples/codex/plugin/.codex-plugin/plugin.json");
const verifyCodex = spawnSync("npm", ["run", "verify:codex"], { cwd: root, encoding: "utf8" });
if (verifyCodex.status === 0) ok("verify:codex");
else fail("verify:codex failed");

console.log("\nnpm audit (high+):");
const audit = spawnSync("npm", ["audit", "--audit-level=high", "--json"], {
  cwd: root,
  encoding: "utf8",
});
let auditMeta = { critical: 0, high: 0 };
if (audit.stdout) {
  try {
    const j = JSON.parse(audit.stdout);
    auditMeta = j.metadata?.vulnerabilities ?? auditMeta;
  } catch {
    /* ignore */
  }
}
const bad = (auditMeta.critical ?? 0) + (auditMeta.high ?? 0);
if (bad === 0 && audit.status === 0) ok("no critical/high npm vulnerabilities");
else if (bad === 0) ok("npm audit exit non-zero but no critical/high");
else fail(`${bad} critical/high npm vulnerabilities — run npm audit`);

const inCi = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";

console.log("\nGitHub repo settings (gh):");
const gh = spawnSync(
  "gh",
  ["api", "repos/navorina-labs/MailAgent", "--jq", ".security_and_analysis"],
  { encoding: "utf8", env: { ...process.env, GH_TOKEN: process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN } }
);
if (gh.status !== 0) {
  if (inCi) console.log("ℹ skipped in CI — GITHUB_TOKEN cannot read security_and_analysis");
  else console.log("ℹ gh skipped — install GitHub CLI and auth locally");
} else {
  try {
    const sa = JSON.parse(gh.stdout.trim() || "{}");
    const ss = sa.secret_scanning?.status === "enabled";
    const pp = sa.secret_scanning_push_protection?.status === "enabled";
    if (inCi && !ss && !pp) {
      console.log("ℹ skipped in CI — run `npm run harden:repo` locally to verify secret scanning");
    } else {
      if (ss) ok("secret scanning enabled");
      else fail("secret scanning disabled — npm run harden:repo");
      if (pp) ok("secret scanning push protection enabled");
      else fail("push protection disabled — npm run harden:repo");
    }
  } catch {
    if (inCi) console.log("ℹ skipped in CI — could not read security_and_analysis");
    else fail("could not parse gh security_and_analysis");
  }
}

console.log("\nCI:");
requireFile(".github/workflows/hol-plugin-scanner.yml");

if (failures.length) {
  console.log(`\n${failures.length} issue(s). See docs/PENTEST-PREP.md · docs/SOC2.md`);
  process.exit(1);
}

console.log("\nSecurity baseline OK");
process.exit(0);

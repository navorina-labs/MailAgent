#!/usr/bin/env node
/** Import MailAgent skill to agentskillhub.dev (operator: skhub login or SKILLHUB_TOKEN) */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const HUB = "https://agentskillhub.dev";
const REPO_URL = "https://github.com/navorinaai/navorina";
const REPO_FULL = "navorinaai/navorina";
const SKILL_PATH = "agents-os/agents/mail-agent/skills/mailagent";

const verify = spawnSync("npm", ["run", "verify:skills"], { cwd: root, stdio: "inherit" });
if (verify.status !== 0) process.exit(verify.status ?? 1);

const token = process.env.SKILLHUB_TOKEN?.trim();
const headers = { "Content-Type": "application/json", Accept: "application/json" };
if (token) headers.Authorization = `Bearer ${token}`;

async function hub(path, body) {
  const res = await fetch(`${HUB}/api/v1${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data };
}

console.log("\nimport-skill-hub — Agent Skill Hub\n");

const analyze = await hub("/repos/analyze", { url: REPO_URL });
if (!analyze.ok) {
  console.error("analyze failed:", analyze.status, analyze.data);
  console.log("\nManual fallback:");
  console.log(`  1. Open ${HUB}`);
  console.log(`  2. Import repo: ${REPO_URL}`);
  console.log(`  3. Select path: ${SKILL_PATH}`);
  console.log("\nOr: skhub login  →  export SKILLHUB_TOKEN=sk_live_…  →  npm run import:skill-hub");
  process.exit(1);
}

const skills = analyze.data.skills ?? [];
const mailagent = skills.find(
  (s) => s.path === SKILL_PATH || s.path === "mailagent" || s.slug === "mailagent"
);
if (!mailagent) {
  console.error("skill not found in analyze response:", skills);
  process.exit(1);
}

console.log("Found:", mailagent.name, `(${mailagent.path})`, mailagent.alreadyImported ? "[already imported]" : "");

if (mailagent.alreadyImported) {
  console.log("\nOK — skill already on Agent Skill Hub. Re-import after SKILL.md changes.");
  process.exit(0);
}

if (!token) {
  console.log("\nSet SKILLHUB_TOKEN (from `skhub login`) to import via API, or use the web UI above.");
  process.exit(0);
}

const imp = await hub("/repos/import", {
  repoFullName: REPO_FULL,
  selectedPaths: [mailagent.path],
});

if (!imp.ok) {
  console.error("import failed:", imp.status, imp.data);
  process.exit(1);
}

const { imported = [], updated = [], reused = [], failed = [] } = imp.data;
console.log("\nimport result:", { imported: imported.length, updated: updated.length, reused: reused.length, failed: failed.length });
if (failed.length) {
  console.error(failed);
  process.exit(1);
}
console.log("\nOK — check search:", `${HUB}/api/v1/search?q=mailagent`);

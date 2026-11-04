#!/usr/bin/env node
/** Stage Agent Skills catalog entry for awesome-agent-skills PR */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "dist/skills-staging");
const skillPath = join(root, "skills/mailagent/SKILL.md");

const verify = spawnSync("npm", ["run", "verify:skills"], {
  cwd: root,
  stdio: "inherit",
});
if (verify.status !== 0) process.exit(verify.status ?? 1);

const gh = spawnSync("gh", ["skill", "publish", "--dry-run"], {
  cwd: root,
  encoding: "utf8",
});
if (gh.status !== 0) {
  console.error("gh skill publish --dry-run failed (install GitHub CLI 2.x+)");
  process.exit(gh.status ?? 1);
}

if (!existsSync(skillPath)) {
  console.error("missing", skillPath);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const entry =
  "- **[navorinaai/mailagent](https://github.com/navorinaai/navorina/tree/main/agents-os/agents/mail-agent/skills/mailagent)** - Disposable inboxes for signup OTP and magic links\n";

const meta = {
  repo: "https://github.com/navorinaai/navorina",
  skillPath: "agents-os/agents/mail-agent/skills/mailagent/SKILL.md",
  install: "npx skills add navorinaai/navorina --skill mailagent",
  ghInstall: "gh skill install navorinaai/navorina mailagent --agent codex",
  category: "Development and Testing",
  section: "Community Skills → Development and Testing",
};

writeFileSync(join(outDir, "README-ENTRY.md"), entry, "utf8");
writeFileSync(join(outDir, "SKILLS-META.json"), JSON.stringify(meta, null, 2) + "\n", "utf8");

console.log("\nprepare-skills-pr OK");
console.log("Entry:", outDir.replace(root + "/", "") + "/README-ENTRY.md");
console.log("\nNext:");
console.log("  1. Fork https://github.com/VoltAgent/awesome-agent-skills");
console.log("  2. Add README-ENTRY.md line under Community → Development and Testing");
console.log("  3. PR title: Add skill: navorinaai/mailagent");
console.log("  4. See docs/SKILLS-SUBMIT.md");

#!/usr/bin/env node
/** Verify Codex plugin structure + smoke npm package. */
import { readFileSync, accessSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.join(root, "examples/codex/plugin");

const required = [
  ".codex-plugin/plugin.json",
  ".mcp.json",
  "README.md",
  "scripts/run-mailagent-mcp.sh",
  "skills/mailagent/SKILL.md",
  ".env.example",
];

const skills = spawnSync("npm", ["run", "verify:skills"], {
  cwd: root,
  stdio: "inherit",
});
if (skills.status !== 0) process.exit(skills.status ?? 1);

const marketplace = path.join(root, ".agents/plugins/marketplace.json");
try {
  accessSync(marketplace);
  JSON.parse(readFileSync(marketplace, "utf8"));
} catch {
  console.error("missing or invalid: .agents/plugins/marketplace.json");
  process.exit(1);
}

for (const rel of required) {
  const p = path.join(pluginRoot, rel);
  try {
    accessSync(p);
  } catch {
    console.error("missing:", rel);
    process.exit(1);
  }
}

const manifest = JSON.parse(
  readFileSync(path.join(pluginRoot, ".codex-plugin/plugin.json"), "utf8")
);
const iface = manifest.interface ?? {};
for (const field of ["websiteURL", "privacyPolicyURL", "termsOfServiceURL"]) {
  const url = iface[field];
  if (typeof url !== "string" || !url.startsWith("https://agents.navorina.ai/")) {
    console.error(`plugin.json interface.${field} must be https://agents.navorina.ai/…`);
    process.exit(1);
  }
}
JSON.parse(readFileSync(path.join(pluginRoot, ".mcp.json"), "utf8"));

const bash = spawnSync("bash", ["-n", path.join(pluginRoot, "scripts/run-mailagent-mcp.sh")]);
if (bash.status !== 0) {
  console.error("launcher bash -n failed", bash.stderr?.toString());
  process.exit(1);
}

const buildMcp = spawnSync("npm", ["run", "build:mcp"], {
  cwd: root,
  stdio: "inherit",
});
if (buildMcp.status !== 0) process.exit(buildMcp.status ?? 1);

const smoke = spawnSync(process.execPath, [path.join(root, "scripts/smoke-codex.mjs")], {
  stdio: "inherit",
});
if (smoke.status !== 0) process.exit(smoke.status ?? 1);

console.log("verify-codex-plugin OK");

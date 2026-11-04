#!/usr/bin/env node
/** Stage MailAgent Codex plugin for awesome-codex-plugins PR */
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = join(root, "dist/catalog-staging");
const pluginDest = join(outRoot, "plugins/Alex0nder/mailagent");
const marketplacePath = join(outRoot, ".agents/plugins/marketplace.json");

const pack = spawnSync("npm", ["run", "package:codex"], {
  cwd: root,
  stdio: "inherit",
});
if (pack.status !== 0) process.exit(pack.status ?? 1);

const manifest = JSON.parse(
  readFileSync(join(root, "examples/codex/plugin/.codex-plugin/plugin.json"), "utf8")
);
const archive = join(root, "dist", `mailagent-codex-plugin-${manifest.version}.tar.gz`);
if (!existsSync(archive)) {
  console.error("missing tarball:", archive);
  process.exit(1);
}

rmSync(pluginDest, { recursive: true, force: true });
mkdirSync(dirname(pluginDest), { recursive: true });

const tar = spawnSync("tar", ["-xzf", archive, "-C", outRoot], { stdio: "inherit" });
if (tar.status !== 0) process.exit(tar.status ?? 1);

// tarball extracts as plugin/ — move to plugins/Alex0nder/mailagent
const extracted = join(outRoot, "plugin");
if (existsSync(extracted)) {
  cpSync(extracted, pluginDest, { recursive: true });
  rmSync(extracted, { recursive: true, force: true });
}

// Catalog-specific README (paths for awesome-codex-plugins layout)
const catalogReadme = join(root, "examples/codex/plugin/README.catalog.md");
if (existsSync(catalogReadme)) {
  cpSync(catalogReadme, join(pluginDest, "README.md"));
}
const strayCatalogReadme = join(pluginDest, "README.catalog.md");
if (existsSync(strayCatalogReadme)) rmSync(strayCatalogReadme);

// Catalog bundle should ship LICENSE (awesome-codex-plugins CONTRIBUTING)
cpSync(join(root, "LICENSE"), join(pluginDest, "LICENSE"));

const entry = {
  name: "mailagent",
  displayName: "MailAgent",
  source: { source: "local", path: "./plugins/Alex0nder/mailagent" },
  policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
  category: "Development & Workflow",
  description:
    "Temporary inboxes for Codex — OTP, magic links, signup QA, simulate-first autotests (23 MCP tools).",
};

mkdirSync(dirname(marketplacePath), { recursive: true });
writeFileSync(
  marketplacePath,
  JSON.stringify(
    {
      name: "mailagent-catalog-staging",
      interface: { displayName: "MailAgent staging entry only" },
      plugins: [entry],
    },
    null,
    2
  ) + "\n",
  "utf8"
);

writeFileSync(
  join(outRoot, "MARKETPLACE-ENTRY.json"),
  JSON.stringify(entry, null, 2) + "\n",
  "utf8"
);

const pluginsEntry = {
  name: "MailAgent",
  url: "https://github.com/navorinaai/navorina/tree/main/agents-os/agents/mail-agent",
  owner: "navorinaai",
  repo: "navorina",
  description: entry.description,
  category: entry.category,
  source: "awesome-codex-plugins",
  install_url:
    "https://raw.githubusercontent.com/navorinaai/navorina/HEAD/agents-os/agents/mail-agent/examples/codex/plugin/.codex-plugin/plugin.json",
};

writeFileSync(
  join(outRoot, "PLUGINS-ENTRY.json"),
  JSON.stringify(pluginsEntry, null, 2) + "\n",
  "utf8"
);

writeFileSync(
  join(outRoot, "README-ENTRY.md"),
  `- [MailAgent](https://github.com/navorinaai/navorina/tree/main/agents-os/agents/mail-agent) - ${entry.description}\n`,
  "utf8"
);

console.log("\nprepare-catalog-pr OK");
console.log("Plugin bundle:", pluginDest.replace(root + "/", ""));
console.log("Merge entry from:", "dist/catalog-staging/MARKETPLACE-ENTRY.json");
console.log("plugins.json entry:", "dist/catalog-staging/PLUGINS-ENTRY.json");
console.log("Or run upstream:", "python3 scripts/generate_plugins_json.py");
console.log("\nNext:");
console.log("  1. Fork https://github.com/hashgraph-online/awesome-codex-plugins");
console.log("  2. Copy dist/catalog-staging/plugins/Alex0nder/mailagent → plugins/Alex0nder/mailagent");
console.log("  3. Add MARKETPLACE-ENTRY.json fields to .agents/plugins/marketplace.json");
console.log("  4. Regenerate plugins.json (generate_plugins_json.py) or merge PLUGINS-ENTRY.json");
console.log("  5. Open PR — see docs/CATALOG-SUBMIT.md");

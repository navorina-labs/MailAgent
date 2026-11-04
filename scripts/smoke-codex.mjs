#!/usr/bin/env node
/** Smoke: Codex MCP entrypoint — npm @mailagent/mcp or local mcp/dist before publish. */
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apiOrigin } from "./lib/public-origins.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const mcpPkgPath = path.join(root, "mcp/package.json");
const mcpVersion = JSON.parse(readFileSync(mcpPkgPath, "utf8")).version;
const pkg = `@mailagent/mcp@${mcpVersion}`;

console.log("smoke-codex →", pkg);

const view = spawnSync("npm", ["view", pkg, "version"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const onNpm = view.status === 0;
if (onNpm) {
  console.log("npm version:", view.stdout.trim());
} else {
  console.log("npm: not published yet — using local mcp/dist");
}

const script = path.join(root, "examples/codex/plugin/scripts/run-mailagent-mcp.sh");
const localMcp = path.join(root, "mcp/dist/index.js");

if (!onNpm && !existsSync(localMcp)) {
  console.error("missing mcp/dist — run: npm run build:mcp");
  process.exit(1);
}

const bash = spawnSync("bash", ["-n", script], { encoding: "utf8" });
if (bash.status !== 0) {
  console.error("bash -n launcher failed", bash.stderr);
  process.exit(1);
}

const rpcInput = [
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "mailagent-codex-smoke", version: "0.0.0" },
    },
  },
  { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
  { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
]
  .map((line) => JSON.stringify(line))
  .join("\n");

const env = {
  ...process.env,
  MAILAGENT_API_URL: apiOrigin(),
  MAILAGENT_API_KEY: process.env.MAILAGENT_API_KEY ?? "mailagent_codex_smoke_redacted",
};

const tools = onNpm
  ? spawnSync("bash", [script], {
      encoding: "utf8",
      input: `${rpcInput}\n`,
      env,
      timeout: 60000,
    })
  : spawnSync(process.execPath, [localMcp], {
      encoding: "utf8",
      input: `${rpcInput}\n`,
      env,
      timeout: 30000,
    });

if (tools.status !== 0) {
  console.error("MCP tools/list failed", tools.stderr || tools.stdout);
  process.exit(1);
}

const toolLines = tools.stdout
  .split(/\r?\n/)
  .filter((line) => line.trim().startsWith("{"));
const listResponse = toolLines
  .map((line) => JSON.parse(line))
  .find((msg) => msg.id === 2);
const names = new Set(listResponse?.result?.tools?.map((tool) => tool.name));

const required = [
  "mailagent_verify_signup",
  "mailagent_create_inbox",
  "mailagent_diagnose_inbox",
  "mailagent_simulate_message",
];
for (const requiredTool of required) {
  if (!names.has(requiredTool)) {
    console.error(`missing MCP tool: ${requiredTool}`);
    process.exit(1);
  }
}

console.log("OK — MCP tools:", Array.from(names).join(", "));

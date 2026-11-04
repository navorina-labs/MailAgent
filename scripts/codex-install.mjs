#!/usr/bin/env node
/**
 * Register MailAgent MCP in Codex from .dev.vars / .env (no manual key copy).
 */
import "./load-env.mjs";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { apiOrigin } from "./lib/public-origins.mjs";

const apiKey = process.env.MAILAGENT_API_KEY ?? process.env.API_KEY;
const apiUrl = apiOrigin();

if (!apiKey) {
  console.error("codex-install: set API_KEY or MAILAGENT_API_KEY in .dev.vars");
  process.exit(1);
}

function findCodex() {
  const macApp =
    "/Applications/Codex.app/Contents/Resources/codex";
  if (existsSync(macApp)) return macApp;
  const which = spawnSync("which", ["codex"], { encoding: "utf8" });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  console.error(
    "codex-install: Codex CLI not found (expected Codex.app or codex in PATH)"
  );
  process.exit(1);
}

const codex = findCodex();

function run(args) {
  const r = spawnSync(codex, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  return r.status ?? 1;
}

console.log("codex-install →", codex);
console.log("api:", apiUrl, "| key: ****" + apiKey.slice(-4));

run(["mcp", "remove", "mailagent"]);

const code = run([
  "mcp",
  "add",
  "mailagent",
  "--env",
  `MAILAGENT_API_URL=${apiUrl}`,
  "--env",
  `MAILAGENT_API_KEY=${apiKey}`,
  "--",
  "npx",
  "-y",
  "-p",
  "@mailagent/mcp@0.2.2",
  "mailagent-mcp",
]);

if (code !== 0) process.exit(code);

console.log("\n--- codex mcp list ---");
process.exit(run(["mcp", "list"]));

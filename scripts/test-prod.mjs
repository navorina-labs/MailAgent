#!/usr/bin/env node
/** Prod gate: smoke + full contract suite (same as CI after deploy) */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { apiOrigin } from "./lib/public-origins.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Prod gate uses the explicitly configured public API, then the legacy fallback. */
const prodEnv = {
  ...process.env,
  MAILAGENT_API_URL: apiOrigin(),
};

function run(script) {
  console.log("\n==========", script, "==========");
  const r = spawnSync("npm", ["run", script], {
    cwd: root,
    stdio: "inherit",
    env: prodEnv,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!process.env.MAILAGENT_API_KEY && !process.env.API_KEY) {
  console.error("test:prod: set MAILAGENT_API_KEY");
  process.exit(1);
}

run("smoke:agent");
run("smoke:qa");
run("test:contract:all");
run("test:pw:simulate");

console.log("\ntest:prod OK");

#!/usr/bin/env node
/** Light prod gate — smoke only (saves KV quota vs full test:prod) */
import "./load-env.mjs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { apiOrigin } from "./lib/public-origins.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

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
  console.error("test:prod:gate: set MAILAGENT_API_KEY");
  process.exit(1);
}

run("smoke:agent");
run("smoke:qa");

console.log("\ntest:prod:gate OK (full suite: npm run test:prod)");

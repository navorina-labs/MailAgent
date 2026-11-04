#!/usr/bin/env node
/** Run all contract-qa against prod (MAILAGENT_API_KEY only) */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { apiOrigin } from "./lib/public-origins.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Use the explicitly configured hosted API, then the legacy fallback. */
const prodEnv = {
  ...process.env,
  MAILAGENT_API_URL: apiOrigin(),
};

const scripts = [
  "contract-qa.mjs",
  "contract-qa-agent.mjs",
  "contract-qa-agent-runs.mjs",
  "contract-qa-workspace-agent.mjs",
  "contract-qa-agent-access.mjs",
  "contract-qa-session.mjs",
  "contract-qa-oidc.mjs",
  "contract-qa-billing.mjs",
  "contract-qa-callback.mjs",
  "contract-qa-notify.mjs",
  "contract-qa-email-check.mjs",
  "contract-qa-attachments.mjs",
  "contract-qa-threads.mjs",
  "contract-qa-outbound.mjs",
  "contract-qa-domains.mjs",
  "contract-qa-search.mjs",
  "contract-qa-extract.mjs",
  "contract-qa-console.mjs",
  "contract-qa-audit.mjs",
  "contract-qa-console-inbox.mjs",
  "contract-qa-team-keys.mjs",
  "contract-qa-dedicated-resend.mjs",
];

for (const name of scripts) {
  console.log("\n---", name, "---");
  const r = spawnSync("node", [path.join(root, "scripts", name)], {
    stdio: "inherit",
    env: prodEnv,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

console.log("\ntest:contract:all OK");

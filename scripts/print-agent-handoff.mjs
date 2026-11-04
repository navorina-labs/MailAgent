#!/usr/bin/env node
/** Print no-secret handoff instructions for another agent/session. */
import { apiOrigin } from "./lib/public-origins.mjs";

const hostedApi = apiOrigin();

const mode = process.argv[2] ?? "qa-pilot";
const supported = new Set(["qa-pilot", "mcp", "self-host"]);

if (!supported.has(mode)) {
  console.error("Usage: npm run print:agent-handoff -- [qa-pilot|mcp|self-host]");
  process.exit(1);
}

const common = `MailAgent agent handoff (no secrets)

Do not paste MAILAGENT_API_KEY in public prompts, issues, PRs, logs, or screenshots.
Full guide: https://github.com/navorinaai/navorina/blob/main/agents-os/agents/mail-agent/docs/AGENT-HANDOFF.md

Agent task:
1. Read https://github.com/navorinaai/navorina/blob/main/agents-os/agents/mail-agent/AGENTS.md
2. Read https://github.com/navorinaai/navorina/blob/main/agents-os/agents/mail-agent/docs/QA-PILOT.md
3. Use MailAgent for disposable signup/login/password-reset inboxes.
4. Do not use Gmail/shared inboxes for OTP checks.
5. If unsure what to do next, call mailagent_plan_next.
6. If sender/subject is unclear, call mailagent_suggest_preset before verify.
7. On timeout, call mailagent_plan_next with status=timeout or call mailagent_diagnose_inbox before retrying.
`;

const blocks = {
  "qa-pilot": `${common}
QA pilot path:

git clone https://github.com/navorinaai/navorina.git /tmp/navorina
cp -R /tmp/navorina/agents-os/agents/mail-agent/examples/qa-pilot-starter ./mailagent-qa
cd mailagent-qa
cp .env.example .env
# edit .env: MAILAGENT_API_URL=${hostedApi}
# edit .env: MAILAGENT_API_KEY=<provided privately>
npm install
npm test

After simulate is green:
- add APP_SIGNUP_URL for staging signup only if available
- set service preset (auth0, clerk, supabase, github, ...)
- report setup time, errors, missing presets, and diagnose clarity
`,
  mcp: `${common}
MCP path:

export MAILAGENT_API_URL=${hostedApi}
export MAILAGENT_API_KEY=<provided privately>
npx -y -p @mailagent/mcp@0.2.7 mailagent-mcp

Codex local:
codex mcp add mailagent -- npx -y -p @mailagent/mcp@0.2.7 mailagent-mcp

Remote MCP:
POST ${hostedApi}/mcp
Authorization: Bearer <MAILAGENT_API_KEY or mat_ token>
`,
  "self-host": `${common}
Self-host path:

Use this when no hosted API key should be issued.

1. Read https://github.com/navorinaai/navorina/blob/main/agents-os/agents/mail-agent/docs/INTEGRATE.md
2. Provision Cloudflare Workers, Neon, Resend, and inbound domain.
3. Run:
   npm install
   npm run doctor
   npm run db:migrate
   npm run dev
4. Connect MCP to the local API:
   MAILAGENT_API_URL=http://127.0.0.1:8787
   MAILAGENT_API_KEY=<local key>
`,
};

console.log(blocks[mode].trim());

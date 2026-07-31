# MailAgent

> [!IMPORTANT]
> Development has moved to [navorina-labs/AgentsOS](https://github.com/navorina-labs/AgentsOS/tree/main/agents/mail-agent). This repository is preserved as a read-only historical snapshot; use AgentsOS for source code, issues, and releases.

Temporary inboxes for **AI agents** and **QA/E2E**: create an inbox, submit its address to a signup/login form, wait for OTP or magic link, and clean up automatically.

Workspace Agent adds supplied-thread summaries, draft replies, reminders, persistent action history, and policy-gated idempotent replies from stored inbound messages. Sending is disabled by default; calendar writes remain disabled.

**Roadmap:** [docs/ROADMAP.md](./docs/ROADMAP.md)  
**Your own agent without our API:** [docs/INTEGRATE.md](./docs/INTEGRATE.md) — self-host, MCP, REST.  
**For QA:** [docs/QA.md](./docs/QA.md) — label, subjectContains, callback, Playwright.

Prod: [webmailagent.com](https://webmailagent.com) · API: [api.webmailagent.com](https://api.webmailagent.com) · Remote MCP: `https://api.webmailagent.com/mcp`.

Agent responses include `otp`, `primaryLink`, `primaryButton`, confidence metadata, raw MIME links, attachments, diagnose hints, run timeline, and cleanup policy fields.

## Stack

- Cloudflare Workers + Hono
- Cloudflare Queues (+ DLQ)
- Durable Objects (SSE `/events`)
- Neon Postgres
- Resend Inbound

Full setup with secrets: **[SETUP.md](./SETUP.md)** · check: `npm run setup:check`

## Quick start

### Hosted QA / agent smoke

```bash
export MAILAGENT_API_URL=https://api.webmailagent.com
export MAILAGENT_API_KEY=ma_...

npm run doctor:qa
npm run smoke:qa
```

QA starter: [examples/qa-pilot-starter](./examples/qa-pilot-starter) · Cypress: [examples/qa-pilot-cypress-starter](./examples/qa-pilot-cypress-starter) · agent handoff: [docs/AGENT-HANDOFF.md](./docs/AGENT-HANDOFF.md).

### Self-host setup

#### 1. Dependencies

```bash
npm install
```

#### 2. Neon

Create a project on [neon.tech](https://neon.tech), copy connection string.

```bash
cp .env.example .env
# fill DATABASE_URL
npm run db:migrate
```

#### 3. Resend

1. API key → `RESEND_API_KEY`
2. Dashboard → **Emails → Receiving** — copy domain (`xxxx.resend.app`) → `INBOX_DOMAIN`
3. **Webhooks** → event `email.received` → URL: `https://<worker>/webhooks/resend`
4. Signing secret → `RESEND_WEBHOOK_SECRET`

Locally: `npm run dev` + tunnel (cloudflared / ngrok) to wrangler port.

#### 4. Worker secrets

```bash
npx wrangler secret put DATABASE_URL
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put RESEND_WEBHOOK_SECRET
npx wrangler secret put API_KEY
npx wrangler secret put INBOX_DOMAIN
```

Local dev: create `.dev.vars` (same keys, see `.env.example`).

#### 5. Deploy

```bash
npm run deploy
```

First deploy creates queues `mailagent-email` and `mailagent-email-dlq`.

## API

Protected `/v1` endpoints require header:

```
Authorization: Bearer <API_KEY>
```

| Method | Path | Description |
|-------|------|----------|
| `GET` | `/v1` | Discovery: endpoints, presets, MCP tools |
| `GET` | `/v1/agent` | Agent hub: tools, flows, docs, OAuth/MCP metadata |
| `GET` | `/v1/openapi.json` | OpenAPI 3.0 (agents) |
| `POST` | `/v1/agent/verify` | Preferred agent verify flow with `agent.primaryAction` |
| `GET` | `/v1/agent/flows` | Signup/login/reset/invite flow templates |
| `GET` | `/v1/agent/runs/:runId/timeline` | Agent-readable run timeline |
| `POST` | `/v1/inboxes/open` | **One-shot:** create → wait → extract → delete |
| `POST` | `/v1/inboxes` | Create inbox (`ttlMinutes`, `service`, `expectFrom`, `notifyEmail`, cleanup policy) |
| `GET` | `/v1/inboxes/:id` | Status |
| `GET` | `/v1/inboxes/:id/messages` | Messages |
| `GET` | `/v1/inboxes/:id/extract` | OTP, links, `primaryButton`, confidence from latest message |
| `GET` | `/v1/inboxes/:id/events` | **SSE** — wait for new message |
| `GET` | `/v1/inboxes/:id/wait?timeout=60` | Poll fallback (every 500ms) |
| `GET` | `/v1/inboxes/:id/diagnose` | Failure recovery hints and retry payloads |
| `POST` | `/v1/inboxes/:id/simulate` | QA/dev simulated message, no SMTP required |
| `GET` | `/v1/inboxes/:id/search?q=` | Search messages |
| `GET` | `/v1/inboxes/:id/callbacks` | `callbackUrl` delivery log (QA) |
| `GET` | `/v1/inboxes/:id/notify-deliveries` | `notifyEmail` relay log (manual QA) |
| `GET` | `/v1/inboxes/:id/messages/:messageId/raw` | Raw MIME `.eml` download |
| `GET` | `/v1/inboxes/:id/messages/:messageId/attachments` | Attachment metadata/downloads |
| `GET/POST` | `/v1/domains` | Custom domain DNS setup |
| `POST` | `/v1/emails/check` | Email check: syntax, disposable, role, MX (no SMTP probe) |
| `DELETE` | `/v1/inboxes/:id` | Delete |
| `GET` | `/v1/stats` | Inbox / message counters (24h) |
| `POST` | `/webhooks/resend` | Resend webhook (no API key) |
| `GET` | `/health` | DB ping |

### Example

```bash
# create inbox
curl -s -X POST "$MAILAGENT_API_URL/v1/inboxes" \
  -H "Authorization: Bearer $MAILAGENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"ttlMinutes":15,"service":"auth0","deleteAfterSuccess":true}' | jq

# SSE (another terminal)
curl -N "$MAILAGENT_API_URL/v1/inboxes/<id>/events" \
  -H "Authorization: Bearer $MAILAGENT_API_KEY"

# send mail to address from response → SSE gets event: message
```

## Reliability

- Webhook responds right after `MAIL_QUEUE.send`
- Idempotency: `messages.provider_id` = Resend `email_id` (UNIQUE)
- Queue retry up to 5 times → DLQ
- Hourly cron: delete expired inboxes
- OTP/links extracted in queue processing, not in webhook

## Custom domain (prod)

In Resend: MX on subdomain `inbox.yourbrand.com`, `INBOX_DOMAIN=inbox.yourbrand.com`.

## MCP for Cursor / Codex / agents

Official protocol [Model Context Protocol](https://modelcontextprotocol.io); SDK: [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) (stdio).

### npm packages

Published packages (see [docs/PUBLISH.md](./docs/PUBLISH.md)):

```bash
npm install @mailagent/mcp      # stdio MCP for Cursor
npm install @mailagent/agent    # REST + remote MCP SDK
npm install @mailagent/qa       # Playwright / Cypress QA
```

Local build from repo:

```bash
npm run build:mcp
npm run build:qa
npm run build:agent
```

Remote MCP (prod): `https://api.webmailagent.com/mcp` — OAuth/DCR: [docs/MCP-OAUTH.md](./docs/MCP-OAUTH.md). Codex guide: [docs/CODEX.md](./docs/CODEX.md).

### Build MCP server (from repo)

Add to `.env` (see `.env.example`):

```
MAILAGENT_API_URL=https://api.webmailagent.com
MAILAGENT_API_KEY=<same API_KEY as Worker>
```

### Connect in Cursor

Project already has [`.cursor/mcp.json`](.cursor/mcp.json):

```json
{
  "mcpServers": {
    "mailagent": {
      "command": "node",
      "args": ["mcp/dist/index.js"],
      "envFile": ".env"
    }
  }
}
```

1. **Cursor Settings → MCP** — server `mailagent` should be green
2. Click **Refresh** on tools list
3. In Agent/Composer: "create inbox via mailagent" — agent will call tools

Globally for all projects: copy block to `~/.cursor/mcp.json` (absolute path to `mcp/dist/index.js`).

### Tools

| Tool | Purpose |
|------|------------|
| `mailagent_issue_access` | Issue short-lived scoped key for one autonomous agent run |
| `mailagent_start_run` | Start server-side run state and get the first autopilot plan |
| `mailagent_report_run` | Report progress/failure and get the next plan |
| `mailagent_next_run` | Resume a run from saved state and get the next plan |
| `mailagent_plan_next` | Autopilot planner: returns the next tool, payload, and recovery steps |
| `mailagent_workspace_summarize` | Workspace preview: summarize supplied mail/thread messages |
| `mailagent_workspace_draft_reply` | Workspace preview: draft reply only, never sends |
| `mailagent_workspace_suggest_reminders` | Workspace preview: suggest reminders/follow-ups |
| `mailagent_workspace_create_reminder` / `list_reminders` / `complete_reminder` | Workspace preview: persist and manage follow-ups |
| `mailagent_workspace_log_action` / `list_actions` | Workspace preview: record and inspect agent action history |
| `mailagent_workspace_get_policy` / `set_policy` | Read or configure admin-owned autonomy guardrails |
| `mailagent_workspace_model_status` | Inspect DeepSeek/Qwen readiness and fallback priority |
| `mailagent_workspace_execute_reply` | Dry-run or execute an idempotent policy-gated reply |
| `mailagent_suggest_preset` | Suggest `service`, `expectFrom`, `subjectContains`, and `flow` from a sample auth email |
| `mailagent_verify_signup` | **Preferred:** wait and return `agent.primaryAction` |
| `mailagent_create_inbox` | Create inbox (`service`, `notifyEmail`, cleanup options) |
| `mailagent_wait_and_extract` | Create/wait/extract/delete one-shot flow |
| `mailagent_wait_for_message` | Wait for first message (SSE, up to 120s) |
| `mailagent_extract_verification` | OTP, links, confidence, `primaryButton` |
| `mailagent_extract_structured` | Presets: `2fa`, `magic_link`, `invite`, `invoice`, `receipt` |
| `mailagent_diagnose_inbox` | Timeout/debug hints and retry payloads |
| `mailagent_simulate_message` | Inject QA mail without SMTP |
| `mailagent_list_messages` | All messages |
| `mailagent_search_messages` | Search messages |
| `mailagent_get_raw_message` | Raw MIME |
| `mailagent_list_attachments` / `mailagent_get_attachment` | Attachments |
| `mailagent_check_email` | App email validation tests only |
| `mailagent_send_message` / `mailagent_list_threads` | Outbound/reply and conversation view |
| `mailagent_get_run_session` / `mailagent_get_run_timeline` | Agent run memory and timeline |
| `mailagent_cleanup_inboxes` | Cleanup by `labelPrefix` or `runId` |
| `mailagent_get_inbox` | Inbox status |
| `mailagent_delete_inbox` | Delete early |

Full current list: `GET /v1/agent` returns `mcpTools` (currently 38).

Agent skill: [`.cursor/skills/mailagent-mcp/SKILL.md`](.cursor/skills/mailagent-mcp/SKILL.md)

### CLI (terminal / CI)

After `npm run build:mcp`:

```bash
# one step: inbox + wait OTP (service=dribbble)
MAILAGENT_API_URL=... MAILAGENT_API_KEY=... \
  node mcp/dist/cli.js open --service dribbble --json

# or step by step
node mcp/dist/cli.js inbox create --service dribbble
node mcp/dist/cli.js wait <inboxId> --json
```

`service` presets include `github`, `google`, `auth0`, `gitlab`, `bitbucket`, `stripe`, `vercel`, `supabase`, `clerk`, `discord`, `openai`, `resend`, `firebase`, and more. Discover the current list via `GET /v1/agent`.

For autonomous browser/QA runs, call `POST /v1/agent/runs/start` or MCP `mailagent_start_run`, execute `plan.nextTool`, then call `mailagent_report_run` after each step. If the agent loses context, `mailagent_next_run` resumes from saved state. When there is no active inbox flow, run planning checks reminders, action history, and the stored autonomy policy: it can select a draft, execute a guarded reply, or return `workspace_waiting` without repeating work.

Workspace autonomy guide: [docs/WORKSPACE-AUTONOMY.md](./docs/WORKSPACE-AUTONOMY.md).

Workspace model routing uses the configured primary provider and automatically falls back between DeepSeek and Qwen. Check readiness with `GET /v1/workspace/models` or MCP `mailagent_workspace_model_status`; an unrestricted admin can run `POST /v1/workspace/models/probe`.

If the next action is unclear, call `POST /v1/agent/autopilot` or MCP `mailagent_plan_next`; it returns `nextTool`, `nextPayload`, and recovery payloads. If sender or subject hints are unclear, call `POST /v1/agent/preset-advice` or MCP `mailagent_suggest_preset` with a sample `from` / `subject` first.

### One-shot (agent / CI)

```bash
curl -s -X POST "$MAILAGENT_API_URL/v1/inboxes/open" \
  -H "Authorization: Bearer $MAILAGENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"service":"github","timeoutSeconds":90}' | jq
```

### MCP debugging

- Logs: Command Palette → **MCP: Show Logs**
- Do not use `console.log` in MCP — stderr only, otherwise JSON-RPC breaks
- Manual check: `cd mcp && MAILAGENT_API_KEY=... MAILAGENT_API_URL=... node dist/index.js`

## Security (allowlist)

When creating inbox pass expected sender — other mail **is not stored**:

```json
{ "expectFrom": "noreply@stripe.com" }
{ "expectFrom": ["noreply@auth0.com", "auth0.com"] }
{ "allowedSenders": "github.com" }
```

Empty `allowedSenders` = accept all (dev only).

## CI

- **Deploy:** `.github/workflows/deploy-worker.yml` — secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`; optional `MAILAGENT_API_KEY` for smoke after deploy
- **npm publish:** `.github/workflows/publish-packages.yml` — secret `NPM_TOKEN`
- **Prod gate:** `npm run test:prod:gate`; full contracts: `npm run test:prod`

Details: [docs/CI.md](./docs/CI.md) · [docs/PUBLISH.md](./docs/PUBLISH.md)

## Current status

- Agent-native PBR is implemented: diagnose recovery, confidence metadata, flow templates, run timeline, cleanup policies, HTML action extraction.
- QA pilot kit is ready; next non-code step is candidate outreach: [docs/PILOT-CANDIDATES.md](./docs/PILOT-CANDIDATES.md).
- No-secret handoff for another agent/session: [docs/AGENT-HANDOFF.md](./docs/AGENT-HANDOFF.md) or `npm run print:agent-handoff`.
- Stripe is on hold until tax/account setup is ready.

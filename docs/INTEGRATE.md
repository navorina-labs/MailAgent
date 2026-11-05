# Connect MailAgent to your project (without our hosted API)

Full openness = **your Worker, your Resend, your API key**.  
No `hello@webmailagent.com` or `api.webmailagent.com` required.

Hosted API at [webmailagent.com](https://webmailagent.com) is only for «I don't want to run infra».

## Two paths

| | Self-host (recommended) | Hosted API |
|--|---------------------------|------------|
| Who owns data | You | Us |
| Need key from us | No | Yes (`hello@`) |
| Need Neon + Resend + Cloudflare | Yes | No |
| Fits NDA product | Yes | Depends on agreement |

---

## 1. Self-host in ~30 minutes

Step by step: **[SETUP.md](../SETUP.md)**.

Short checklist:

```bash
git clone https://github.com/navorina-labs/MailAgent.git
cd MailAgent
npm install
cp .dev.vars.example .dev.vars   # DATABASE_URL, API_KEY, Resend…
npm run db:migrate
npm run dev                      # http://127.0.0.1:8787
npm run verify
npx wrangler login
npm run deploy                   # your *.workers.dev
```

After deploy:

1. Resend webhook → `https://<your-worker>/webhooks/resend`
2. Generate **your** `API_KEY` (any long random string) → `wrangler secret put API_KEY`
3. In agent project: `MAILAGENT_API_URL=https://<your-worker>` and `MAILAGENT_API_KEY=<your key>`

---

## 2. Agent in Cursor (MCP) — in your repo

Copy from MailAgent to **your** project (or add submodule / npm workspace):

### 2.1 Build MCP

```bash
# in MailAgent clone or as git submodule
npm run build:mcp
```

### 2.2 `.cursor/mcp.json` in your project root

```json
{
  "mcpServers": {
    "mailagent": {
      "command": "node",
      "args": ["/absolute/path/to/MailAgent/mcp/dist/index.js"],
      "env": {
        "MAILAGENT_API_URL": "https://your-worker.workers.dev",
        "MAILAGENT_API_KEY": "your-secret-key"
      }
    }
  }
}
```

Or `envFile`: `.env` in your project (do not commit key to git).

### 2.3 Skill for agent (optional)

Copy [`.cursor/skills/mailagent-mcp/SKILL.md`](../.cursor/skills/mailagent-mcp/SKILL.md) →  
`your-project/.cursor/skills/mailagent-mcp/SKILL.md`

Agent will know when to call `mailagent_wait_and_extract`.

### 2.4 Check in Cursor

**Settings → MCP** → server `mailagent` green → **Refresh tools**.

In Composer: «create inbox for github signup and wait for OTP».

---

## 3. Any agent / backend (REST only)

Without MCP — any stack with HTTP:

```bash
curl -X POST "$MAILAGENT_API_URL/v1/inboxes/open" \
  -H "Authorization: Bearer $MAILAGENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"service":"github","timeoutSeconds":90,"deleteAfter":true}'
```

- Discovery: `GET /v1`
- Schema: `GET /v1/openapi.json`

Examples for LangChain, custom agent loop, CI — same contract.

---

## 4. Playwright / Cypress (QA)

Package in repo: `packages/mailagent-qa`.

```bash
npm run build:qa
# in test repo:
npm install file:../path/to/MailAgent/packages/mailagent-qa
```

```typescript
import { createMailAgentQa } from "@mailagent/qa";

const mail = createMailAgentQa(); // reads MAILAGENT_API_URL / MAILAGENT_API_KEY
```

More: [docs/QA.md](./QA.md).

---

## 5. Do not commit to git

| Secret | Where |
|--------|-----|
| `API_KEY` | wrangler secret, `.dev.vars`, CI secrets |
| `DATABASE_URL` | wrangler secret |
| `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | wrangler secret |
| `MAILAGENT_API_KEY` in agent app | `.env`, CI |

In repo keep only `.env.example` without values.

---

## 6. Custom domain for inbox

Not required to use `*.resend.app`:

1. Resend → Receiving → add subdomain `inbox.yourcompany.com`
2. MX per Resend instructions
3. `INBOX_DOMAIN=inbox.yourcompany.com`

Test addresses: `anything@inbox.yourcompany.com`.

---

## 7. FAQ

**Need access to Alex0nder GitHub?**  
No. Clone public repo, fork if you want.

**Can I fork and rename?**  
Yes, MIT license.

**Will agent call webmailagent.com?**  
Only if you set our URL. With self-host — only your Worker.

**How to add custom `service` preset?**  
`src/lib/service-presets.ts` → deploy. Or `expectFrom` in API without preset.

---

## Links

- [SETUP.md](../SETUP.md) — Neon, Resend, deploy  
- [README.md](../README.md) — API, MCP tools  
- [docs/QA.md](./QA.md) — E2E  
- [mcp/README.md](../mcp/README.md) — MCP debug  

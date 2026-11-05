# MailAgent v1.0 — AgentMail and more

Goal: **full email API for agents** (inbound + outbound + threads) **plus** advantages [AgentMail](https://www.agentmail.to/) does not have.

## Positioning

| | AgentMail | MailAgent v1.0 |
|---|-----------|----------------|
| Inbound | ✅ | ✅ |
| Outbound / reply | ✅ | ✅ |
| Threads | ✅ | ✅ |
| Attachments | ✅ | ✅ |
| Realtime (SSE/webhooks) | ✅ | ✅ + MCP progress |
| Custom domains | ✅ API | ✅ |
| Semantic search | ✅ | ✅ |
| Document extraction | ✅ | ✅ |
| MCP | ✅ | ✅ OAuth + 44 tools |
| SDK (TS/Python) | ✅ | ✅ TS SDKs + Python + MCP |
| Enterprise / SOC 2 | ✅ | ✅ audit log + retention |
| **Open source** | ❌ | ✅ MIT |
| **Self-host (Cloudflare)** | ❌ | ✅ |
| **QA / E2E (`@mailagent/qa`)** | ❌ | ✅ |
| **Simulate without SMTP** | ❌ | ✅ |
| **Diagnose on timeout** | ❌ | ✅ |
| **Agent verify + primaryAction** | partial | ✅ |
| **Multi-step run memory** | partial | ✅ session API + MCP |
| **Developer email relay** | ❌ | ✅ `notifyEmail` + delivery log + quota |

---

## Phases

### Phase 1 — v0.17–0.18: Two-way mail ✅

| Task | API / MCP |
|--------|-----------|
| `POST /v1/inboxes/:id/send` | text/html, to[], cc[] |
| `POST …/messages/:id/reply` | In-Reply-To / References |
| `GET …/threads`, `GET …/threads/:id/messages` | conversation view |
| MCP `mailagent_send_message`, `mailagent_list_threads` | agents |
| Inbound → thread_id (subject / headers) | auto-grouping |

**Resend:** verified send domain (`OUTBOUND_FROM`), Reply-To = inbox address.

### Phase 2 — v0.19–0.20: Custom domains ✅

| Task | |
|--------|--|
| `POST /v1/domains` | add domain, DNS instructions |
| `GET /v1/domains/:id/verify` | poll MX/SPF status |
| `POST /v1/inboxes` `{ username, domainId }` | like AgentMail |
| Team-scoped domains | multi-tenant |

### Phase 3 — v0.21: Semantic search ✅

| Task | |
|--------|--|
| Embedding at ingest (Workers AI / external) | pgvector in Neon |
| `GET /v1/inboxes/:id/search?q=` | semantic + keyword |
| MCP `mailagent_search_messages` | |

### Phase 4 — v0.22: Structured extraction ✅

| Task | |
|--------|--|
| `POST /v1/messages/:id/extract` `{ schema }` | JSON from body/attachments |
| Presets: invoice, receipt, 2FA | |
| Keep OTP/links as today | backward compatible |

### Phase 5 — v0.23–0.28: Hosted SaaS ✅ (API + console)

| Task | Status |
|--------|--------|
| Stripe checkout + portal (API) | ✅ code; live secrets optional |
| Web console (inboxes, threads, domains) | ✅ |
| API keys UI, team invites | ✅ |
| Codex Marketplace publish | manual |

### Phase 6 — v0.24+: Enterprise ✅ (foundation)

| Task | Status |
|--------|--------|
| Audit log + retention policies | ✅ |
| SOC 2 narrative / SLA | draft — [security.html](https://webmailagent.com/docs/security.html) · [SOC2.md](./SOC2.md) |
| Dedicated Resend (tenant isolation) | ✅ — [DEDICATED-DOMAINS.md](./DEDICATED-DOMAINS.md) |

---

## Always-on (do not drop)

- `@mailagent/qa`, simulate, diagnose, contract CI, Playwright simulate gate
- Remote MCP + OAuth + DCR
- Self-host docs ([INTEGRATE.md](./INTEGRATE.md))
- Service presets + allowlist
- Agent run session memory (`GET/PATCH …/runs/:runId/session`)

---

## Metrics beyond AgentMail

1. **Time-to-first-OTP** — MCP one-shot + simulate for CI
2. **Time-to-debug-failure** — diagnose API (unique)
3. **Self-host TCO** — $0 infra except Cloudflare + Neon
4. **QA adoption** — Playwright fixture installs vs generic inbox API

---

## Next step

**v1.0 baseline complete** — API, MCP, QA starters, `@mailagent/mcp@0.2.16`, `@mailagent/agent@0.1.13`, `@mailagent/qa@0.1.17`, PyPI `mailagent-agent@0.1.0`.
**Waiting on external:** catalog PR merge · first external QA pilot feedback · Stripe · Codex Directory · SOC 2.  
**New repo work:** product features from pilot feedback when issue [#5](https://github.com/navorina-labs/MailAgent/issues/5) has data.  
Discovery: `GET /v1/agent` → `packages` · `distribution` · [DISTRIBUTION-STATUS.md](./DISTRIBUTION-STATUS.md).

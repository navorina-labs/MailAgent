# Product backlog — service development

Stripe **on hold** until tax/account setup is ready · QA pilot kit ready; candidate outreach pending ([PILOT-CANDIDATES.md](./PILOT-CANDIDATES.md), [PILOT-ONBOARD.md](./PILOT-ONBOARD.md)).

Agent-native backlog: [AGENT-PBR.md](./AGENT-PBR.md).

Workspace Agent backlog: [WORKSPACE-AGENT-PBR.md](./WORKSPACE-AGENT-PBR.md) — real inbox/calendar assistant direction. P0 starts with safe read-only/draft-only APIs and DeepSeek/Qwen-compatible LLM adapter.

Context OS **done** for agents on repo ([skills/mailagent/SKILL.md](../skills/mailagent/SKILL.md) § Context OS).

P0–P3 **done** (pilot #20 = human). Next: **P4** (console & SDK polish).

---

## P0 — agent & QA experience (core loop) ✅

| # | Feature | Status |
|---|---------|--------|
| 1 | **Console search** | ✅ `console-inbox.html` → `GET …/search` |
| 2 | **Bulk inbox cleanup UI** | ✅ `dashboard.html` → `DELETE …?labelPrefix=` |
| 3 | **Diagnose deep-link** | ✅ `debugUiUrl` on verify timeout + console banner |
| 4 | **Top signup presets** | ✅ `gitlab`, `bitbucket` + recipes + contract |
| 5 | **`verify_signup` ergonomics** | ✅ `SERVICE_SUBJECT_HINTS` + auto default + MCP docs |

**Done when:** agent can verify GitLab signup E2E with zero custom allowlist research.

---

## P1 — platform & observability ✅

| # | Feature | Status |
|---|---------|--------|
| 6 | **Team event webhook** | ✅ `GET/PUT/DELETE /v1/team/webhooks` |
| 7 | **Delivery log in console** | ✅ callback log + refresh |
| 8 | **Usage dashboard** | ✅ rate-limit meter on dashboard |
| 9 | **Public status** | ✅ `/v1/status` + `status.html` |
| 10 | **Run explorer** | ✅ label filter + console/debug links |

**Done when:** team lead debugs a failed CI run without curl.

---

## P2 — differentiation vs AgentMail ✅

| # | Feature | Status |
|---|---------|--------|
| 11 | **Simulate scenario library** | ✅ `scenario` + `GET …/simulate/scenarios` |
| 12 | **Extract presets expansion** | ✅ `magic_link`, `invite` |
| 13 | **Python SDK** | ✅ `packages/mailagent-agent-py` |
| 14 | **Landing use-case pages** | ✅ `playwright-email-verification.html`, `mcp-signup-qa.html` |
| 15 | **Inbox TTL presets** | ✅ `resolveTtlMinutes(service)` |

---

## P3 — distribution & pilot polish

| # | Feature | Status |
|---|---------|--------|
| 16 | **PyPI publish pipeline** | ✅ `publish:agent-py` + CI step |
| 17 | **SEO / nav links** | ✅ footer + landing cross-links |
| 18 | **QA SDK `scenario`** | ✅ `@mailagent/qa` + pilot starter test |
| 19 | **Pilot starter ↔ monorepo** | ✅ CI installs local `@mailagent/qa` |
| 20 | **Run first external pilot** | ⏳ key issued · invite ready · feedback issue [#5](https://github.com/navorina-labs/MailAgent/issues/5) |
| 21 | **Team webhook docs** | ✅ `teams.html#event-webhook` |
| 22 | **QA troubleshooting URL** | ✅ `/docs/qa-troubleshooting.html` |
| PyPI `mailagent-agent@0.1.0` | ✅ |

**Done when:** `pip install mailagent-agent` works; pilot repo forks starter and passes CI.

---

## P4 — console & SDK visibility

| # | Feature | Status |
|---|---------|--------|
| 23 | **Debug simulate scenarios UI** | ✅ `debug.html` scenario picker |
| 24 | **Python SDK on agents docs** | ✅ `agents.html` + landing |
| 25 | **Package matrix in AGENTS.md** | ✅ npm + PyPI |
| 26 | **Console simulate UI** | ✅ `console-inbox.html` |
| 27 | **Python landing page** | ✅ `python-agent-verify.html` |
| 28 | **Pilot scoped key issued** | ✅ `external-pilot` (local `issue:pilot-key`) |

---

## P6 — email existence check (Reacher) ✅

| # | Feature | Status |
|---|---------|--------|
| 34 | `POST /v1/emails/check` | ✅ |
| 35 | MCP `mailagent_check_email` | ✅ |
| 36 | Reacher HTTP proxy (`REACHER_BACKEND_URL`) | removed — self-contained local + DoH MX |
| 37 | Disposable block on `notifyEmail` | ✅ |

Spec: [EMAIL-CHECK.md](./EMAIL-CHECK.md)

---

## Explicitly not now

| Item | Reason |
|------|--------|
| Stripe live | on hold |
| SOC 2 / pentest | external vendor |
| Catalog PR merges | maintainer |
| Full Context OS in hosted runtime | repo/skill only |

---

## P5 — developer email relay (manual QA)

| # | Feature | Status |
|---|---------|--------|
| 29 | **`notifyEmail` on inbox create** — OTP/summary to developer's real inbox | ✅ |
| 30 | **Temp address for signup** — any MailAgent inbox; relay ≠ signup address | ✅ |
| 31 | **Notify delivery log** — `GET …/notify-deliveries` + console | ✅ |
| 32 | **MCP + SDK `notifyEmail`** | ✅ MCP · `@mailagent/agent` + `@mailagent/qa` |
| 33 | **Contract `contract-qa-notify`** (simulate path) | ✅ |
| 34 | **Daily plan quota** — `notifyEmailsPerDay` + usage meters | ✅ |
| 35 | **Run explorer simulate links** — agent run inbox → console simulate | ✅ |

Spec: [DEV-EMAIL-RELAY.md](./DEV-EMAIL-RELAY.md)

**Done when:** dev puts temp `address` in signup form, reads OTP in their real Gmail while debugging manually.

---

## P7 — agent-native reliability

Spec: [AGENT-PBR.md](./AGENT-PBR.md)

| # | Feature | Status |
|---|---------|--------|
| 38 | **Failure recovery hints** — machine-readable `diagnose` next action | ✅ |
| 39 | **Verification confidence** — confidence + alternatives | ✅ |
| 40 | **Agent flow templates** — signup/login/reset/invite recipes | ✅ |
| 41 | **Run timeline** — agent trace by `runId` | ✅ |
| 42 | **Auto-cleanup policies** — keep failure, delete success | ✅ |
| 43 | **Agent-safe HTML actions** — buttons/primary CTA extraction | ✅ |

## Current next work

1. Workspace Agent P0 — safe summaries, draft replies, and reminder suggestions for supplied mail payloads.
2. P3 #20 — identify/contact Pilot #1 candidate using [PILOT-CANDIDATES.md](./PILOT-CANDIDATES.md).
3. After they accept, send `print:pilot-invite -- external-pilot` + scoped key out-of-band.
4. Pilot #1 — external test repo copies starter, sets `MAILAGENT_API_KEY`, and gets green `npm test`.
5. Pilot #1 — add staging `APP_SIGNUP_URL` + service preset, then collect feedback in [#5](https://github.com/navorina-labs/MailAgent/issues/5).

Track in [ROADMAP.md](./ROADMAP.md) § v0.69.

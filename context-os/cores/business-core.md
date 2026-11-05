# Business Core — MailAgent

## Purpose

Business Core отвечает на вопросы **зачем существует продукт**, **кто платит и кто использует**, **какие боли закрываем**, **как монетизируем**, **какие лимиты и KPI**, **как распространяем** и **с кем не конкурируем напрямую**.

Загружай это ядро, когда агент или человек спрашивает:

- «Что такое MailAgent?» / positioning / value proposition
- Планы (`free`, `pro`, `enterprise`, `legacy`), `PLAN_LIMITS`, 429 quota
- Personas: QA, AI agents, teams, operator
- Stripe billing, upgrade path, enterprise features
- KPI, SLA, adoption metrics
- Дистрибуция: MCP, npm, Agent Skills, Codex
- **Не целевая аудитория** (privacy burners, shared inbox для людей)

Не загружай для технических деталей pipeline (Queue, DO, migrations) — см. `technical-core`.  
Не загружай для пошаговых API flows — см. `product-core`.

---

## Entities

| Entity | Описание | Где в коде / docs |
|--------|----------|-------------------|
| **PlanId** | Тариф: `free` \| `pro` \| `enterprise` \| `legacy` | `src/lib/plans.ts` |
| **PLAN_LIMITS** | Rate limit, max inboxes, team keys, custom domains, dedicated Resend | `src/lib/plans.ts` |
| **Team** | Multi-tenant: plan, Stripe customer/subscription, dedicated Resend webhook | `teams` table, `api-key-store.ts` |
| **ApiKey** | Bearer `ma_…`, scopes (`labelPrefix`, `readOnly`), привязка к team | `api_keys` table |
| **Persona: QA Engineer** | Playwright/Cypress, CI, `@mailagent/qa` | `docs/QA.md` |
| **Persona: AI Agent** | Cursor, Codex, remote MCP, verify без human OTP | `AGENTS.md`, `skills/mailagent/SKILL.md` |
| **Persona: Integration Dev** | REST SDK, self-host, INTEGRATE.md | `packages/agent`, `docs/INTEGRATE.md` |
| **Persona: Team Admin** | Scoped keys, billing portal, custom domains | `docs/billing.html`, `/v1/team` |
| **Persona: Operator (human)** | Одноразовые секреты, deploy, Stripe, Resend | `docs/OPERATOR.md` |
| **Scenario** | Agent verify, CI E2E, self-host, enterprise | см. раздел «Сценарии» |
| **Pain → Solution** | Таблица болей QA из docs/QA.md | |
| **KPI** | Verify success rate, time-to-OTP, flake rate, MCP adoption | `docs/SLA.md`, `DISTRIBUTION-STATUS.md` |
| **Monetization** | Stripe Checkout Pro, portal, webhook → plan | `src/services/billing.ts` |
| **Distribution channel** | npm, MCP, skills, Codex plugin, catalogs | `docs/DISTRIBUTION-STATUS.md` |
| **Competitive frame** | vs shared test@ inbox, vs Mailosaur/MailSlurp | `docs/QA.md`, `docs/QA-MIGRATION.md` |
| **NOT target user** | Privacy burners, human disposable email | `skills/mailagent/SKILL.md` |

**Связи:**

```
Team ──1:N── ApiKey ──creates── Inbox (label, service, callbackUrl)
Team ──plan── PlanId ──limits── PLAN_LIMITS
Team ──optional── Stripe customer/subscription ──webhook── plan change
Persona (Agent) ──uses── MCP tools / POST /v1/agent/verify
Persona (QA) ──uses── @mailagent/qa / POST /v1/inboxes/open
```

---

## Decision history (table + narratives)

| Дата / эра | Решение | Альтернатива | Почему выбрали |
|------------|---------|--------------|----------------|
| v0.1 | **Agent-first + QA-first**, не consumer email | Privacy burner SaaS | Программные inbox с allowlist; OTP/magic link extract; MCP/REST |
| v0.2 | **Cloudflare Workers** hosted + self-host MIT | VPS + SMTP server | Edge, Queues, DO для SSE; Resend inbound без своего MX |
| v0.3 | **Resend inbound** вместо собственного SMTP | Mailgun inbound, custom Postfix | Быстрый webhook → queue; enterprise = dedicated Resend per team |
| v0.4+ | **MCP как primary agent surface** (29 tools) | Только REST | Cursor/Codex/remote MCP; discovery `GET /v1/agent` |
| v0.5 | **Service presets** (`service: auth0`) | Только ручной `expectFrom` | 25 пресетов allowlist + subject hints для agents |
| v0.6 | **`POST /v1/inboxes/open`** one-shot | Только create + wait отдельно | CI one-liner; меньше flaky race между create и submit |
| v0.7 | **Simulate** (`POST …/simulate`) для contract tests | Real SMTP в CI | Без DATABASE_URL в gate нельзя; simulate = idempotent QA |
| v0.8 | **Stripe self-serve Pro** (free→pro) | Manual invoicing only | `POST /v1/billing/checkout`; enterprise = sales/operator |
| v0.9 | **Agent Skills + Codex plugin** distribution | Docs only | `npx skills add`, marketplace; catalog PRs for visibility |
| v0.10 | **Run sessions** (`runId`, label `agent-{runId}`) | Stateless only | Multi-step agents persist JSON state across tool calls |
| ongoing | **NOT privacy burners** в positioning | Broad «temp mail» SEO | Снижает abuse; чёткий ICP = agents + QA |

### Narrative: Agent-first positioning

MailAgent создавался как **инфраструктура для автономной верификации signup**, когда AI-агент (Cursor, Codex, custom MCP client) должен пройти email verification **без человека**, который читает письмо и копирует OTP. REST и MCP возвращают структурированный `verification.otp` и `verification.primaryLink`, плюс `agent.primaryAction` в `mailagent_verify_signup`. Это не замена Gmail и не «временная почта для людей».

### Narrative: QA parallel inboxes vs shared test@

Классическая боль E2E — один `test@company.com` на всю команду: гонки в CI, чужие письма, flaky poll. MailAgent решает **inbox на тест** через `label: ci-$GITHUB_RUN_ID`, bulk cleanup `DELETE /v1/inboxes?labelPrefix=ci-$RUN_ID`, и опционально `callbackUrl` вместо blind poll. Конкурентное преимущество перед «просто отдельным ящиком» — programmatic API, SSE, extract, simulate, scoped keys.

### Narrative: Hosted SaaS + self-host

MIT repo позволяет self-host (Neon + Resend + Worker). Hosted prod (`webmailagent.com` / `api.webmailagent.com`) монетизируется через **teams + Stripe Pro** и enterprise (dedicated Resend, higher limits). Self-host остаётся для интеграторов и air-gapped CI; hosted — для быстрого старта с API key из dashboard.

### Narrative: Monetization guardrails

Stripe checkout **только free → pro** (`canUpgradeViaStripe`). Enterprise — operator-assigned plan + dedicated Resend webhook path. Downgrade через `customer.subscription.deleted` webhook → `free`. Legacy plan — grandfathered лимиты без team keys (`maxTeamKeys: 0`).

### Narrative: Distribution without catalog merge

Установка работает **до** merge PR в awesome-codex / awesome-agent-skills: npm, `npx skills add`, Codex marketplace. Catalog PRs — visibility, не blocker. CI `check:catalog-prs` отслеживает статус.

---

## Sources

| Приоритет | Файл | Содержание |
|-----------|------|------------|
| 1 | `README.md` | Positioning one-liner, stack, quick start |
| 2 | `docs/QA.md` | Pain table, CI scenario, Playwright |
| 3 | `src/lib/plans.ts` | `PlanId`, `PLAN_LIMITS` (source of truth) |
| 4 | `src/services/billing.ts` | Stripe checkout, portal, webhook |
| 5 | `AGENTS.md` | MCP tools list, autotests, discovery |
| 6 | `skills/mailagent/SKILL.md` | Agent skill, NOT burners, install paths |
| 7 | `docs/DISTRIBUTION-STATUS.md` | npm/skills/Codex, catalog PRs |
| 8 | `docs/SLA.md` | Draft SLA tiers |
| 9 | `docs/QA-MIGRATION.md` | vs Mailosaur/MailSlurp |
| 10 | `docs/STRIPE-SETUP.md` | Operator Stripe setup |
| 11 | `docs/OPERATOR.md` | Human secrets only |
| 12 | `context-os/CORE-DEFINITIONS.md` | Router: when to load business-core |

---

## Positioning

### One-liner (официальный)

**Temporary inboxes for AI agents & QA/E2E — MCP, REST, OTP/magic links.**

(RU) **Временные почтовые ящики для AI-агентов и QA/E2E-тестов** — programmatic создание адреса, ожидание письма, извлечение OTP или magic link без ручного разбора HTML.

### Elevator pitch (3 предложения)

1. MailAgent даёт **disposable inbox на один тест или один agent run** с API/MCP, а не общий ящик на команду.
2. Inbound через **Resend webhook → queue → Neon**; клиент получает **OTP и primaryLink** через REST, SSE или callback.
3. **29 MCP tools**, Agent Skills, npm SDK — агент проходит signup verification **без human OTP check**; QA использует `@mailagent/qa` и `POST /v1/inboxes/open` в CI.

### Prod URLs

| Surface | URL |
|---------|-----|
| Landing + docs + dashboard | https://webmailagent.com |
| API + MCP remote | https://api.webmailagent.com |
| Discovery | `GET https://api.webmailagent.com/v1/agent` |
| OpenAPI | `GET https://api.webmailagent.com/v1/openapi.json` |

### Category

- **Primary:** Developer tool / email testing API for automation
- **Secondary:** MCP server for AI agents
- **Not:** Consumer temp-mail website, email client, marketing ESP

### Value pillars

| Pillar | Для кого | Обещание |
|--------|----------|----------|
| **Autonomous verify** | AI agents | `mailagent_verify_signup` → `agent.primaryAction` |
| **CI-stable QA** | QA engineers | Label per run, simulate, callback, diagnose |
| **Agent-native** | Platform integrators | MCP + OpenAPI + Skills + remote `/mcp` |
| **Team SaaS** | Orgs | Scoped keys, billing, custom domains, audit |
| **Self-host option** | Security-conscious | MIT, same API, own Resend/Neon |

---

## Pain table (QA + agents)

Источник: `docs/QA.md`, дополнено agent-specific болями из `AGENTS.md` и production support patterns.

| # | Боль | Симптом | Решение MailAgent | API / tool |
|---|------|---------|-------------------|------------|
| 1 | **Shared test inbox** | Чужое письмо, race в parallel CI | Inbox на тест: `label: ci-$RUN_ID` | `POST /v1/inboxes`, `labelPrefix` cleanup |
| 2 | **Долгое ожидание в тесте** | sleep 60–120s, brittle | One-shot open + server-side wait | `POST /v1/inboxes/open` |
| 3 | **Flaky poll** | Письмо пришло, test timeout | SSE + server poll 500ms; callback | `GET …/events`, `GET …/wait`, `callbackUrl` |
| 4 | **Парсинг HTML** | Regex по body, ломается на шаблонах | `verification.otp`, `primaryLink` | extract at ingest, `GET …/extract` |
| 5 | **Debug после fail** | «Не знаем, что в inbox» | List messages, diagnose, debug UI URL | `GET …/messages`, `mailagent_diagnose_inbox` |
| 6 | **Staging vs prod mail** | Письмо не от того From | `service` preset или `expectFrom` allowlist | `SERVICE_EXPECT_FROM` in presets |
| 7 | **Agent без MCP** | Agent не знает как ждать почту | 29 MCP tools + Skill | `@mailagent/mcp`, remote `/mcp` |
| 8 | **Human OTP bottleneck** | Человек копирует код из письма | Autonomous verify flow | `mailagent_verify_signup`, `test:prod` |
| 9 | **CI без real SMTP** | Staging не шлёт mail | Simulate inject | `POST …/simulate`, contract tests |
| 10 | **Quota surprises** | 429 mid-suite | Documented plan limits + headers | `X-RateLimit-*`, `PLAN_LIMITS` |
| 11 | **Multi-step agent** | Теряется контекст между tools | Run session by `runId` | `mailagent_get_run_session` |
| 12 | **Wrong message** | Welcome email вместо verify | `subjectContains`, `messageIndex` | wait params, presets hints |
| 13 | **Outbound reply flows** | Нужен thread после verify | Send via Resend on verified domain | `mailagent_send_message` |
| 14 | **Brand domain in tests** | `@company.com` inbox | Custom domain + verify DNS | `POST /v1/domains` |
| 15 | **Key leakage in CI** | Shared prod key | Scoped `labelPrefix`, readOnly keys | `/v1/team/keys` |

---

## User personas

### 1. QA Engineer (primary revenue adjacency)

**Профиль:** SDET, QA automation, owns Playwright/Cypress in GitHub Actions.

**Jobs to be done:**
- Прогнать signup/login E2E со staging email verification
- Изолировать parallel runs без shared mailbox
- Быстро понять, почему упал wait (diagnose, messages list)

**Типичный stack:** `@mailagent/qa`, `MAILAGENT_API_KEY` in CI secrets, `label: ci-$GITHUB_RUN_ID`.

**Success:** Green CI без manual inbox check; cleanup `labelPrefix` после job.

**Docs entry:** `docs/QA.md`, `docs/QA-PILOT.md`, `examples/qa-pilot-starter`.

---

### 2. AI Agent (primary product vision)

**Профиль:** Coding agent in Cursor/Codex/custom runner with MCP.

**Jobs to be done:**
- Create inbox → fill signup form → get OTP/link → complete verify → delete inbox
- Retry on timeout with diagnose; simulate in dev

**Типичный stack:** `@mailagent/mcp` stdio or `POST https://api.webmailagent.com/mcp`, Skill `mailagent`.

**Success:** `agent.primaryAction` consumed without parsing HTML; `test:prod` gate passes.

**Docs entry:** `AGENTS.md`, `docs/agents.html`, `skills/mailagent/SKILL.md`.

---

### 3. Integration Developer

**Профиль:** Backend/devops building internal QA platform or agent orchestrator.

**Jobs to be done:**
- Embed verify in own service via REST SDK
- Self-host for compliance
- OpenAPI codegen

**Типичный stack:** `@mailagent/agent`, `mailagent-agent` (Python), self-host Worker.

**Success:** Same API contract locally and prod; `docs/INTEGRATE.md` checklist done.

---

### 4. Team Admin / Engineering Manager

**Профиль:** Owns API keys, billing, custom domains for org.

**Jobs to be done:**
- Issue scoped keys per project (`labelPrefix: ci-frontend-`)
- Upgrade to Pro via Stripe portal
- Enterprise: dedicated Resend, audit log

**Типичный stack:** `public/dashboard.html`, `GET /v1/me`, `POST /v1/billing/checkout`.

**Success:** No cross-team inbox leakage; plan limits match usage.

---

### 5. Operator (human, non-ICP as end user)

**Профиль:** Repo owner / SRE — **не** daily MailAgent user.

**Jobs to be done:** One-time secrets (Stripe, Resend webhook, OIDC), deploy, `issue:pilot-key`.

**Docs entry:** `docs/OPERATOR.md`, `docs/YOUR-TURN.md` — explicitly **human secrets only**.

---

## NOT target users

Явное исключение снижает abuse и фокусирует GTM.

| NOT target | Почему | Что сказать |
|------------|--------|-------------|
| **Privacy / burner email seekers** | Нет UI «прочитать почту»; allowlist; programmatic API | «Use MailAgent for agent/QA automation, not anonymous browsing» |
| **Human reading inbox in browser** | Dashboard — debug console, не email client | Console for operators debugging failed CI |
| **Mass marketing / cold email** | Inbound-only product; outbound only verified domains | Outbound = reply on owned domain, not bulk send |
| **Generic «temp mail» SEO traffic** | Wrong expectations, support cost | Landing emphasizes agents + QA |
| **Teams wanting shared human inbox** | Product = **per-test isolation**, not shared team mailbox | Use label + list API, not one address for all |
| **Gmail replacement for agents** | Gmail = user's real mailbox; skill explicitly warns | Membrane/github skills **after** auth, MailAgent **during** signup |

Источник: `skills/mailagent/SKILL.md` — *«Not for human privacy burners — programmatic agent inboxes with allowlists»*.

---

## Главные сценарии (business view)

### Scenario A: Agent signup verification (hero)

**Trigger:** Agent task «register on service X with email verify».

**Business outcome:** Account created without human OTP.

**Steps (business):**
1. Create inbox with `service` preset (allowlist + subject hint).
2. Agent submits signup form with `address`.
3. Wait + extract → `otp` or `primaryLink`.
4. Agent completes verification step.
5. Delete inbox (`deleteAfter: true` default in verify tools).

**Revenue tie-in:** Consumes active inbox quota + rate limit; Pro for higher parallelism.

**KPI:** Time create→primaryAction; verify success rate; retries after diagnose.

---

### Scenario B: QA/E2E in CI

**Trigger:** PR pipeline runs Playwright signup test.

**Business outcome:** Stable green CI vs shared mailbox flakes.

**Steps:**
1. `label: ci-$GITHUB_RUN_ID`, `service: auth0`, `timeoutSeconds: 120`.
2. Playwright `@mailagent/qa` fixture or `POST /v1/inboxes/open`.
3. On failure: diagnose + messages in artifact.
4. Job end: `DELETE ?labelPrefix=ci-$RUN_ID`.

**Revenue tie-in:** Teams buy Pro for 100 active inboxes / 300 req/min.

**KPI:** Flake rate; mean wait time; 429 rate per team.

---

### Scenario C: Contract / simulate QA (no SMTP)

**Trigger:** CI gate post-deploy or PR without real email infrastructure.

**Business outcome:** API contract verified cheaply.

**Steps:** `POST …/simulate` → wait/extract contract tests (`npm run test:contract:qa`).

**KPI:** Gate duration (~15 API calls in `test:prod:gate`).

---

### Scenario D: Self-host / integrate

**Trigger:** Enterprise security requires own Worker + DB.

**Business outcome:** Same API, customer-operated infra; optional future support contract.

**Docs:** `docs/INTEGRATE.md`, `SETUP.md`, MIT license.

---

### Scenario E: Enterprise team

**Trigger:** Org needs custom `@mail.company.com`, dedicated Resend, audit, higher limits.

**Business outcome:** `enterprise` plan, operator-assigned, `dedicatedResend: true`.

**Features:** Custom domains (25), 500 active inboxes, 50 team keys, priority SLA (draft).

---

### Scenario F: Multi-step agent run

**Trigger:** Long agent workflow spans multiple MCP calls.

**Business outcome:** Retention via run sessions (`runId`), observability in `/v1/agent/runs`.

**KPI:** Session patch frequency; run list usage.

---

## PLAN_LIMITS (полная таблица)

Source of truth: `src/lib/plans.ts` — `PLAN_LIMITS` и `normalizePlan()`.

### Summary table

| Plan | `rateLimitPerMinute` | `maxActiveInboxes` | `maxTeamKeys` | `maxCustomDomains` | `dedicatedResend` |
|------|----------------------|--------------------|---------------|--------------------|-------------------|
| **free** | 60 | 10 | 5 | 1 | no |
| **pro** | 300 | 100 | 20 | 10 | no |
| **enterprise** | 600 | 500 | 50 | 25 | **yes** |
| **legacy** | 120 | 500 | **0** | 3 | no |

### Field semantics

| Field | Business meaning | Enforcement |
|-------|------------------|-------------|
| `rateLimitPerMinute` | API calls per key per minute (hosted) | KV rate limit; headers `X-RateLimit-*` |
| `maxActiveInboxes` | Non-expired inboxes per team/hint scope | `429 inbox_limit_reached` on create |
| `maxTeamKeys` | Additional scoped API keys per team | Team routes; `0` on legacy = no team keys feature |
| `maxCustomDomains` | Verified custom domains for `@company` addresses | `POST /v1/domains` quota |
| `dedicatedResend` | Separate Resend inbound webhook `/webhooks/resend/team/:teamId` | Enterprise only; isolation + compliance |

### Plan assignment

| Plan | How assigned |
|------|--------------|
| `free` | Default new team |
| `pro` | Stripe `checkout.session.completed` → `setTeamPlan(..., "pro")` |
| `enterprise` | Operator manual / sales |
| `legacy` | Grandfathered accounts (`normalizePlan` preserves) |

### Downgrade path

Stripe `customer.subscription.deleted` or inactive status → `free`. Limits apply immediately; existing inboxes above quota may block new creates until expiry/cleanup.

### wrangler default vs plan

Note: `wrangler.jsonc` may set `RATE_LIMIT_PER_MINUTE=120` as env default; **per-team plan** from DB overrides via `PLAN_LIMITS[plan].rateLimitPerMinute` in application logic. Always trust `GET /v1/me` for current plan.

### Quota headers (client-facing)

On rate limit: `429` + `Retry-After` + `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

On inbox limit: `429` + `error: inbox_limit_reached`.

---

## Monetization (Stripe)

### Model

| Tier | Price mechanism | Self-serve |
|------|-----------------|------------|
| **Free** | $0 | yes |
| **Pro** | Stripe subscription (`STRIPE_PRICE_PRO`) | yes — `POST /v1/billing/checkout` |
| **Enterprise** | Custom / operator | no — contact / manual plan |
| **Legacy** | Grandfathered | n/a |

### Stripe integration surface

| Endpoint | Purpose |
|----------|---------|
| `POST /v1/billing/checkout` | Create Checkout Session (`mode: subscription`) |
| `POST /v1/billing/portal` | Customer portal (manage/cancel) |
| `POST /webhooks/stripe` | `checkout.session.completed`, subscription lifecycle |

### Checkout rules (`src/services/billing.ts`)

- Requires **registered team key** (not legacy env-only key) — error `billing_requires_registered_key`.
- **`canUpgradeViaStripe`:** only `free` → `pro`. Pro/enterprise cannot self-serve upgrade via same checkout (enterprise = sales).
- Metadata: `client_reference_id` = `teamId`, `metadata[team_id]`.
- Success/cancel URLs default to `dashboard.html?billing=success|cancel`.

### Webhook events

| Event | Action |
|-------|--------|
| `checkout.session.completed` | `setTeamPlan(teamId, "pro", { customerId, subscriptionId })` |
| `customer.subscription.updated` | If canceled/unpaid/incomplete_expired → `free` |
| `customer.subscription.deleted` | → `free` |

### Env secrets (operator)

| Var | Purpose |
|-----|---------|
| `STRIPE_SECRET_KEY` | API calls |
| `STRIPE_PRICE_PRO` | Price ID for Pro subscription |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature verify |

Setup: `docs/STRIPE-SETUP.md`, `npm run doctor:billing`.

### Enterprise monetization (non-Stripe-self-serve)

- Dedicated Resend inbound path per team
- Higher `PLAN_LIMITS`
- Draft SLA 99.9% + priority support (`docs/SLA.md`)
- Audit log retention (`AUDIT_RETENTION_DAYS`)

### Billing discovery for clients

`GET /v1/me` returns:

```json
{
  "billing": {
    "stripeConfigured": true,
    "canUpgradeViaStripe": true,
    "checkoutPath": "/v1/billing/checkout",
    "portalPath": "/v1/billing/portal"
  }
}
```

---

## KPIs и операционные метрики

### Product KPIs (north star adjacency)

| KPI | Definition | Target direction | Measurement |
|-----|------------|------------------|-------------|
| **Verify success rate** | `verify_signup` / `open` returning primaryAction or otp | ↑ | MCP logs, prod contract tests |
| **Time to OTP (p95)** | create inbox → extract otp/link | ↓ | Wait timeout analytics, CI |
| **CI flake rate** | Tests failing on wait then pass on retry | ↓ | Customer CI; mitigate simulate/callback |
| **Diagnose→retry success** | After `diagnose_inbox`, second attempt wins | ↑ | Agent telemetry |
| **MCP adoption** | Installs: npm download, skill add, remote MCP calls | ↑ | `DISTRIBUTION-STATUS`, `/v1/agent` hits |
| **Post-deploy gate pass** | `test:prod:gate` after deploy | 100% | GitHub Actions |
| **429 rate** | Quota denials per active team | ↓ (or → upgrade) | Rate limit metrics |
| **Active inboxes per team** | Usage vs plan limit | fit plan | `GET /v1/stats`, console |

### Operational metrics

| Metric | Source |
|--------|--------|
| Inboxes/messages 24h | `GET /v1/stats` |
| Queue DLQ depth | Cloudflare dashboard / observability |
| Webhook processing errors | Worker logs, Resend dashboard |
| Contract test duration | CI `test:contract:*` |

### SLA (draft, not legally active until billing launch)

| Tier | Uptime (draft) | Support |
|------|----------------|---------|
| Self-host | N/A | Community / MIT |
| Hosted free | Best effort | None |
| Pro | 99.5%/month | Email, next business day |
| Enterprise | 99.9%/month | Priority channel |

Public: https://webmailagent.com/docs/sla.html

---

## Competitive positioning

### vs Shared test inbox (`test@company.com`)

| Dimension | Shared inbox | MailAgent |
|-----------|--------------|-----------|
| Isolation | None — all tests see all mail | **Per-test inbox** via `label` |
| Parallel CI | Races, wrong OTP | Unique address per run |
| Programmatic access | IMAP hacks, manual | REST/MCP first-class |
| OTP extraction | Manual or custom parser | Built-in `verification` object |
| Cleanup | Inbox fills up | TTL + `DELETE labelPrefix` |
| Allowlist | Often none | `service` / `expectFrom` |
| Agent autonomy | Human reads mail | `mailagent_verify_signup` |
| Real-time | Poll IMAP | SSE + wait + callback |
| Cost model | «Free» hidden ops cost | Metered plans, predictable API |

**Message:** MailAgent — not «ещё один email», а **API для изолированного programmatic inbox на каждый run**.

### vs Mailosaur / MailSlurp / Mailtrap

| Dimension | Classic email testing SaaS | MailAgent |
|-----------|---------------------------|-----------|
| Primary ICP | QA teams | **QA + AI agents** (MCP-native) |
| Agent integration | REST SDK | **29 MCP tools**, Skills, remote MCP |
| CI without SMTP | Varies | **`simulate`** + contract tests |
| Self-host | Usually no | **MIT self-host** |
| OAuth MCP | Rare | `mat_` JWT, OIDC browser login |
| Run session state | Uncommon | **`runId`** persistence |

Migration guide: `docs/QA-MIGRATION.md`.

### vs Consumer temp-mail sites

MailAgent **не конкурирует** с 10minutemail и аналогами: нет публичного anonymous inbox UI, есть API key, allowlist, agent positioning.

### vs Gmail API for agents

Gmail = пользовательский mailbox, OAuth scope, не disposable. Skill explicitly: MailAgent for signup verify; app skills after login.

---

## Distribution (MCP, skills, npm)

### Discovery endpoint

`GET /v1/agent` → `mcpTools`, `distribution`, `remoteMcp`, npm package versions.

### Install channels (live today)

| Channel | Command / path |
|---------|----------------|
| **Agent Skill** | `npx skills add navorina-labs/MailAgent --skill mailagent` |
| **Pinned skill** | `gh skill install navorina-labs/MailAgent mailagent --pin skills-0.2.5` |
| **Codex marketplace** | `codex plugin marketplace add navorina-labs/MailAgent` → `codex plugin install mailagent` |
| **MCP npm (stdio)** | `npx -y -p @mailagent/mcp@latest mailagent-mcp` |
| **Remote MCP** | `POST https://api.webmailagent.com/mcp` + Bearer |
| **REST SDK** | `npm i @mailagent/agent` |
| **QA SDK** | `npm i @mailagent/qa` |
| **Python SDK** | `pip install mailagent-agent` |
| **Cursor project** | `.cursor/mcp.json` → `@mailagent/mcp` |

Canonical skill: `skills/mailagent/SKILL.md` — sync via `npm run sync:skills`.

### npm packages

| Package | Role | Version source |
|---------|------|----------------|
| `@mailagent/mcp` | stdio MCP server | `mcp/package.json` |
| `@mailagent/agent` | REST verify SDK | `packages/agent` |
| `@mailagent/qa` | Playwright/Cypress helpers | `packages/mailagent-qa` |
| `mailagent-agent` | Python SDK | PyPI |

Publish: tag `v*` → `.github/workflows/publish-packages.yml`.

### MCP clients matrix

| Client | Config |
|--------|--------|
| Cursor | `.cursor/mcp.json` → `node mcp/dist/index.js` or npx |
| Codex | `codex mcp add mailagent -- npx -y -p @mailagent/mcp@0.2.8 mailagent-mcp` |
| Any HTTP client | Remote MCP JSON-RPC at `/mcp` |
| OAuth MCP | `GET /mcp/auth`, `POST /v1/oauth/token` |

### Agent Skills ecosystem

- Repo skill path: `skills/mailagent/SKILL.md`
- Cursor synced copy: `.cursor/skills/mailagent-mcp/SKILL.md`
- Categories: Email, QA, Agents, MCP
- Works **with** other skills (Membrane github/slack) **after** MailAgent handles signup verify

### QA pilot distribution

| Asset | Path |
|-------|------|
| Playwright starter | `examples/qa-pilot-starter` |
| Cypress starter | `examples/qa-pilot-cypress-starter` |
| 30-min guide | `docs/QA-PILOT.md` |
| Validate | `npm run wizard:qa-pilot` |

### Catalog visibility (pending merge, not blocking install)

| Catalog | PR |
|---------|-----|
| awesome-codex-plugins | #195 |
| awesome-agent-skills | #659 |

Check: `npm run check:catalog-prs`.

### Blocked external (operator prep)

| Item | Blocker | Prep doc |
|------|---------|----------|
| Codex Plugin Directory | OpenAI self-serve | `CODEX-DIRECTORY-SUBMIT.md` |
| Agent Skill Hub search | Hub OAuth | `SKILLS-SUBMIT.md` |
| Stripe Pro + SLA live | Stripe account | `STRIPE-SETUP.md` |

Full status: `docs/DISTRIBUTION-STATUS.md`.

### Content / docs SEO

- https://webmailagent.com/docs/agents.html
- https://webmailagent.com/docs/qa.html
- https://webmailagent.com/docs/autotests.html
- OpenAPI for LLM/agent discovery

---

## Glossary (business)

| Term | Meaning |
|------|---------|
| **Inbox** | Temporary address with TTL, allowlist, optional label/callback |
| **Label** | QA metadata; CI uses `ci-$RUN_ID`; agents use `agent-{runId}` |
| **Service preset** | Shorthand for `expectFrom` + subject hints (`auth0`, `github`, …) |
| **Verify** | Wait for allowed message + extract OTP/links |
| **Simulate** | Inject message without Resend (QA/contracts) |
| **Team** | Billing + quota scope for API keys |
| **Scoped key** | `labelPrefix` restriction for CI safety |
| **Dedicated Resend** | Enterprise isolated inbound webhook |

---

## Pairs with

| Core | When to add |
|------|-------------|
| `product-core` | How flows work step-by-step |
| `auth-billing-core` | 401, scopes, OAuth, Stripe details |
| `deployment-testing-core` | CI, doctor, test:prod |
| `technical-core` | Worker, Queue, DO architecture |

Router: `context-os/router/routing-map.json`, eval: `eval/questions.json`.

# Deployment & Testing Core — MailAgent

Специализированное ядро Context OS: развёртывание Worker на Cloudflare, локальная разработка, CI/CD, автотесты на prod и разделение обязанностей оператора и агента. Источник истины для вопросов «как задеплоить», «какой тест запустить после изменения», «почему CI красный без DATABASE_URL».

---

## Purpose

MailAgent — Cloudflare Worker с Neon Postgres, Resend, Queues, Durable Objects, R2 и Workers AI. Продукт рассчитан на **автономную верификацию агентами** (Cursor, Codex, CI): после однократной настройки секретов оператором smoke и contract-тесты гоняются на **prod API** (`https://api.webmailagent.com`) без участия человека в OTP-проверках и без `DATABASE_URL` в CI.

Это ядро отвечает на четыре класса вопросов:

1. **Локальная разработка** — `npm run dev`, `.dev.vars`, туннель для Resend webhook.
2. **Production deploy** — `wrangler deploy`, секреты, R2, custom domain `api.webmailagent.com`.
3. **CI/CD** — шесть workflow в `.github/workflows/`, prod gate после деплоя.
4. **Тестирование** — матрица doctor/smoke/contract/`test:prod`/Playwright; узкие `test:contract:qa:*` после точечных правок.

Ключевой принцип: **контрактные тесты инжектят письма через `POST /v1/inboxes/:id/simulate`**, а не через реальный SMTP и не через прямой доступ к БД. Это позволяет агентам и GitHub Actions проверять API на живом prod без Neon connection string в секретах Actions.

---

## Entities

Сущности, с которыми работает deploy и testing pipeline.

### Wrangler bindings (Cloudflare)

| Binding | Тип | Ресурс | Назначение |
|---------|-----|--------|------------|
| `MAIL_QUEUE` | Queue producer | `mailagent-email` | Асинхронная обработка входящих писем после webhook Resend |
| `INBOX_WAIT` | Durable Object | класс `InboxWait` | SSE/wait: уведомление клиента о новом сообщении |
| `RAW_MIME` | R2 bucket | `mailagent-raw-mime` | Хранение сырых `.eml` и крупных вложений |
| `RATE_LIMIT` | KV namespace | id в `wrangler.jsonc` | Rate limit по API key / плану |
| `AI` | Workers AI | platform binding | Semantic search, structured extract (LLM) |
| `ASSETS` | Static assets | `./public` | Лендинг, docs HTML, `run_worker_first: true` |

Дополнительно при первом деплое создаётся **consumer queue** `mailagent-email` с DLQ `mailagent-email-dlq` (`max_retries: 5`, `max_batch_size: 5`, `max_batch_timeout: 2`).

Cron: `0 * * * *` — hourly purge expired inboxes и audit events.

### Environment variables (категории)

- **Worker secrets** (wrangler / `.dev.vars`): `DATABASE_URL`, `RESEND_*`, `API_KEY`/`API_KEYS`, `INBOX_DOMAIN`, опционально `STRIPE_*`, `OIDC_*`, `OUTBOUND_FROM`, `MCP_OAUTH_*`.
- **Worker vars** (plain в `wrangler.jsonc`): `DEFAULT_TTL_MINUTES`, `RATE_LIMIT_PER_MINUTE`, `RATE_LIMIT_KV_WRITE_EVERY`, `AUDIT_RETENTION_DAYS`.
- **Клиент MCP / тесты** (`.env`): `MAILAGENT_API_URL`, `MAILAGENT_API_KEY`.
- **GitHub Actions secrets**: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `MAILAGENT_API_KEY`, опционально `DATABASE_URL`, `PYPI_API_TOKEN`.

### Test scripts (npm)

| Слой | Скрипт-оркестратор | Состав |
|------|-------------------|--------|
| Light gate | `scripts/test-prod-gate.mjs` | `smoke:agent` → `smoke:qa` |
| Full gate | `scripts/test-prod.mjs` | smoke + `test:contract:all` + `test:pw:simulate` |
| All contracts | `scripts/test-contract-all.mjs` | 17 × `contract-qa-*.mjs` |
| Local doctor | `scripts/doctor.mjs` | env + DB + prod probe |
| QA doctor | `scripts/doctor.mjs --qa` | prod API без локальной БД |

### Secrets (три уровня)

1. **Cloudflare Worker** (`npx wrangler secret put …`) — runtime prod.
2. **Локально** (`.dev.vars` + `.env`) — dev Worker + MCP client.
3. **GitHub Actions** — deploy token + CI API key для prod gate.

---

## Decision history

Зафиксированные архитектурные решения, влияющие на deploy и тесты.

### Contract tests без DATABASE_URL

**Решение:** CI и агенты проверяют prod API только через HTTP + `MAILAGENT_API_KEY`. Сообщения создаются через `POST …/simulate`, не через Resend inbound и не через SQL.

**Причина:** Neon connection string в GitHub Secrets — лишний риск; агенты в Cursor/Codex не должны иметь доступ к БД. Simulate покрывает create → wait → extract → delete так же, как реальное письмо для API-контракта.

**Следствие:** `DATABASE_URL` в Actions **опционален** — нужен только для auto `db:migrate` на deploy. Без него миграции пропускаются, gate всё равно работает.

### Prod gate на deploy (light, не full)

**Решение:** После каждого push в `main` (с путями Worker) CI запускает `npm run test:prod:gate` (~15 API-вызовов), а не полный `test:prod`.

**Причина:** Экономия KV quota (`RATE_LIMIT` writes) и времени CI. Полный suite — перед merge вручную, на tag `v*` (publish workflow) или через `test-prod-full.yml`.

**Следствие:** PR проходит тот же light gate (`qa-smoke.yml`). Регрессии в редко трогаемых contract-скриптах могут всплыть только на full gate — это осознанный trade-off.

### Deploy fails без MAILAGENT_API_KEY

**Решение:** Шаг smoke после deploy **обязателен**; отсутствие ключа → `exit 1`.

**Причина:** Деплой без верификации опаснее красного CI. Оператор один раз кладёт CI key (`npm run issue:pilot-key` или team key с префиксом `ci-`).

### Path-filtered deploy

**Решение:** `deploy-worker.yml` триггерится только при изменениях в `src/`, `public/`, `migrations/`, `wrangler.jsonc`, lockfile, contract scripts, skills и связанных путях.

**Причина:** Правки только в `docs/` или вспомогательных скриптах не должны катить Worker.

### Custom domain api.webmailagent.com, не CNAME на workers.dev

**Решение:** API на **Workers Custom Domain**; CNAME `api` → `*.workers.dev` даёт **522**.

**Следствие:** В тестах и MCP дефолт `MAILAGENT_API_URL=https://api.webmailagent.com`. Оркестраторы (`test-prod.mjs`, `test-contract-all.mjs`) **принудительно** подставляют prod URL, игнорируя локальный `.env` с `127.0.0.1:8787`.

### npm Trusted Publishing (OIDC)

**Решение:** `publish-packages.yml` публикует `@mailagent/*` без `NPM_TOKEN` — через OIDC на npmjs.com.

**Следствие:** Перед publish обязателен **full** `test:prod` с Playwright.

### Simulate-only в CI, не simulate-inbound.mjs

**Решение:** В CI запрещён паттерн `simulate-inbound.mjs` с прямым доступом к очереди/БД. Только HTTP simulate.

Документировано в `docs/AUTOTESTS.md` § «Adding a new contract test».

---

## Sources

| Документ / файл | Содержание |
|-----------------|------------|
| [SETUP.md](../../SETUP.md) | Neon, Resend, `.dev.vars`, deploy, custom domain |
| [wrangler.jsonc](../../wrangler.jsonc) | Bindings, vars, queues, cron, account_id |
| [package.json](../../package.json) | Все npm scripts deploy/test |
| [AGENTS.md](../../AGENTS.md) | Автономия агента, таблица «после изменения → тест» |
| [docs/AUTOTESTS.md](../../docs/AUTOTESTS.md) | Слои тестов, prod gate, contract table |
| [docs/CI.md](../../docs/CI.md) | Secrets, workflows, типичные ошибки deploy |
| [docs/OPERATOR.md](../../docs/OPERATOR.md) | Чеклист оператора (секреты один раз) |
| [src/env.ts](../../src/env.ts) | Полный тип `Env` — secrets и bindings |
| [scripts/test-contract-all.mjs](../../scripts/test-contract-all.mjs) | Порядок contract-скриптов |
| [scripts/test-prod.mjs](../../scripts/test-prod.mjs) | Full gate order |
| [scripts/test-prod-gate.mjs](../../scripts/test-prod-gate.mjs) | Light gate order |
| [.dev.vars.example](../../.dev.vars.example) | Шаблон локальных секретов |
| [.github/workflows/](../../.github/workflows/) | CI/CD определения |

---

## Local dev setup

### Prerequisites

- Node.js 22+ (как в CI)
- Аккаунт Cloudflare (`wrangler login` для deploy)
- Neon Postgres (pooled connection string)
- Resend (API key, receiving domain, webhook secret)
- Опционально: cloudflared / ngrok для локального webhook

### Установка

```bash
git clone https://github.com/navorina-labs/MailAgent.git
cd MailAgent
npm install
```

### Neon + миграции

1. [neon.tech](https://neon.tech) → новый проект → **Connection pooling** ON.
2. Скопировать connection string в `.dev.vars` как `DATABASE_URL=…`.
3. Можно убрать `&channel_binding=require` — иногда ломает serverless driver.
4. Применить миграции:

```bash
DATABASE_URL="postgresql://..." npm run db:migrate
```

### Resend

1. API Keys → `RESEND_API_KEY=re_…`
2. **Emails → Receiving** → домен вида `abc123.resend.app` → `INBOX_DOMAIN=abc123.resend.app`
3. **Webhooks** → событие `email.received`:
   - **Локально:** `https://<tunnel-host>/webhooks/resend`
   - **Prod:** `https://api.webmailagent.com/webhooks/resend` (или workers.dev URL до custom domain)
4. Signing secret → `RESEND_WEBHOOK_SECRET=whsec_…`

### Локальные секреты

```bash
cp .dev.vars.example .dev.vars
cp .env.example .env
# Заполнить оба; API_KEY одинаковый
```

Для MCP в `.env`:

```
MAILAGENT_API_URL=http://127.0.0.1:8787
MAILAGENT_API_KEY=<тот же что API_KEY в .dev.vars>
```

### Туннель для webhooks (локально)

Worker на `127.0.0.1:8787` недоступен Resend напрямую. Нужен HTTPS-туннель:

```bash
# Терминал 1
npm run dev

# Терминал 2 — пример cloudflared
cloudflared tunnel --url http://127.0.0.1:8787
# Скопировать https://….trycloudflare.com → Resend webhook URL
```

Без туннеля локально работают **simulate** и contract-тесты против prod; реальный inbound Resend — только с туннелем или на prod.

### Проверка локальной среды

```bash
node scripts/setup-check.mjs   # или npm run setup:check
npm run doctor                 # .dev.vars, DB ping, опционально prod
npm run dev                    # терминал 1 — Worker :8787
npm run verify                 # терминал 2 — локальный smoke
```

### MCP в Cursor

После `npm run build:mcp` и заполненного `.env`:

- `.cursor/mcp.json` → `node mcp/dist/index.js`
- Settings → MCP → `mailagent` → Refresh tools

---

## Production deploy

### Первый deploy (ручной чеклист)

```bash
npx wrangler login

# Обязательные секреты Worker
npx wrangler secret put DATABASE_URL
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put RESEND_WEBHOOK_SECRET
npx wrangler secret put API_KEY
npx wrangler secret put INBOX_DOMAIN

# R2 (Dashboard → R2 → enable, затем)
npx wrangler r2 bucket create mailagent-raw-mime

npm run deploy
npm run db:migrate   # с DATABASE_URL в env или secret уже на Worker
```

### Список секретов Worker (wrangler)

Просмотр (имена, не значения):

```bash
npx wrangler secret list
```

Типичный набор после полной настройки:

| Secret | Обязательность |
|--------|----------------|
| `DATABASE_URL` | да |
| `RESEND_API_KEY` | да |
| `RESEND_WEBHOOK_SECRET` | да |
| `API_KEY` или `API_KEYS` | да |
| `INBOX_DOMAIN` | да |
| `OUTBOUND_FROM` | опционально — send/reply |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_AUDIENCE` | опционально — MCP browser login |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO` | опционально — Pro billing |
| `MCP_OAUTH_JWT_SECRET`, `MCP_OAUTH_TOKEN_TTL_SEC` | опционально — OAuth tokens |

### R2 bucket `mailagent-raw-mime`

- Binding `RAW_MIME` уже в `wrangler.jsonc`.
- Хранит raw MIME после ingest; лимиты: `RAW_MIME_MAX_BYTES` (default 15MB), `RAW_MIME_AGENT_MAX_BYTES` (512KB для агентов), `ATTACHMENT_MAX_STORE_BYTES` (2MB).
- Документация: [docs/RAW-MIME-R2.md](../../docs/RAW-MIME-R2.md).

### Custom domain `api.webmailagent.com`

**Лендинг:** `webmailagent.com` (Netlify). **API:** Worker custom domain.

**Нельзя:** CNAME `api` → `mailagent.*.workers.dev` (ошибка 522).

**Вариант A — Dashboard:**

1. Workers & Pages → `mailagent` → Settings → Domains & Routes
2. Add Custom Domain → `api.webmailagent.com`
3. Удалить старый CNAME на workers.dev при наличии

**Вариант B — CLI:**

```bash
npm run deploy
npx wrangler domains add api.webmailagent.com
```

Проверка:

```bash
curl https://api.webmailagent.com/health
```

Обновить:

- Resend webhook URL на prod
- `MAILAGENT_API_URL=https://api.webmailagent.com` в `.env` / CI

Если deploy падает из-за `routes` в `wrangler.jsonc` — зона DNS должна быть в том же Cloudflare account, либо убрать `routes` и привязать домен через Dashboard.

### Side effects первого deploy

Автоматически создаются/привязываются:

- Queues: `mailagent-email`, `mailagent-email-dlq`
- KV: `RATE_LIMIT` (id в wrangler.jsonc)
- R2: `mailagent-raw-mime`
- Durable Object: `InboxWait` (migration tag `v1`)
- Workers AI binding `AI`
- Static assets из `public/`

### Post-deploy верификация

```bash
MAILAGENT_API_URL=https://api.webmailagent.com \
MAILAGENT_API_KEY=ma_… \
  npm run test:prod:gate
```

Полный gate перед релизом:

```bash
MAILAGENT_API_URL=https://api.webmailagent.com \
MAILAGENT_API_KEY=ma_… \
  npm run test:prod
```

---

## wrangler.jsonc bindings table

Полная карта из [wrangler.jsonc](../../wrangler.jsonc):

| Binding | Тип CF | Имя ресурса / класс | Конфиг | Роль в приложении |
|---------|--------|---------------------|--------|-------------------|
| `MAIL_QUEUE` | Queue (producer) | `mailagent-email` | consumer: batch 5, timeout 2s, retries 5, DLQ `mailagent-email-dlq` | Webhook кладёт job; consumer парсит письмо, пишет в DB/R2, будит `INBOX_WAIT` |
| `INBOX_WAIT` | Durable Object | `InboxWait` | migration `v1`, `new_sqlite_classes` | Long-poll / SSE wait для `/v1/inboxes/:id/wait` и events |
| `RAW_MIME` | R2 | `mailagent-raw-mime` | bucket binding | Сырые `.eml`, кэш вложений |
| `RATE_LIMIT` | KV | namespace id `e9ce5a89…` | preview_id для dev | Счётчики rate limit; `RATE_LIMIT_KV_WRITE_EVERY` сэмплирует записи |
| `AI` | Workers AI | platform | `ai.binding` | Embeddings (`SEARCH_EMBED_MODEL`), LLM extract (`EXTRACT_MODEL`) |
| `ASSETS` | Assets | `./public` | `run_worker_first: true` | Статика: лендинг, docs; Worker обрабатывает API первым |

### Plain vars в wrangler.jsonc (не секреты)

| Var | Default | Назначение |
|-----|---------|------------|
| `DEFAULT_TTL_MINUTES` | `30` | TTL disposable inbox |
| `RATE_LIMIT_PER_MINUTE` | `120` | Лимит запросов на ключ |
| `RATE_LIMIT_KV_WRITE_EVERY` | `10` | Писать в KV каждый N-й запрос |
| `AUDIT_RETENTION_DAYS` | `90` | Хранение audit log |

Worker meta: `name=mailagent`, `account_id=42ae092824ce3429ee3f914b43603273`, `compatibility_date=2026-01-15`, `nodejs_compat_v2`.

---

## Environment variables

### Обязательные (Worker runtime)

| Переменная | Где задать | Описание |
|------------|------------|----------|
| `DATABASE_URL` | wrangler secret / `.dev.vars` | Neon pooled Postgres |
| `RESEND_API_KEY` | wrangler secret / `.dev.vars` | Resend API |
| `RESEND_WEBHOOK_SECRET` | wrangler secret / `.dev.vars` | Подпись webhook `whsec_…` |
| `API_KEY` | wrangler secret / `.dev.vars` | Master key (legacy) |
| `INBOX_DOMAIN` | wrangler secret / `.dev.vars` | Домен receiving, напр. `id.resend.app` |

### Опциональные (Worker runtime)

| Переменная | Default / условие | Описание |
|------------|-------------------|----------|
| `API_KEYS` | — | Список pilot keys через запятую (альтернатива одному `API_KEY`) |
| `OUTBOUND_FROM` | inbox address | Verified From для `send` / reply |
| `STRIPE_SECRET_KEY` | — | Stripe API; без него billing 503 |
| `STRIPE_WEBHOOK_SECRET` | — | `/webhooks/stripe` |
| `STRIPE_PRICE_PRO` | — | Price id Pro подписки |
| `OIDC_ISSUER` | — | Auth0/Google issuer URL |
| `OIDC_CLIENT_ID` | — | OAuth client |
| `OIDC_CLIENT_SECRET` | — | OAuth secret |
| `OIDC_AUDIENCE` | — | Auth0 audience |
| `MCP_OAUTH_JWT_SECRET` | fallback `API_KEY` | HMAC для `mat_` JWT |
| `MCP_OAUTH_TOKEN_TTL_SEC` | `3600` | TTL OAuth access token |
| `RAW_MIME_MAX_BYTES` | 15MB | Лимит raw MIME в R2 |
| `RAW_MIME_AGENT_MAX_BYTES` | 512KB | Лимит отдачи агенту |
| `ATTACHMENT_MAX_STORE_BYTES` | 2MB | Кэш вложения в R2 при ingest |
| `SEARCH_EMBED_MODEL` | `@cf/baai/bge-base-en-v1.5` | Workers AI embed model |
| `EXTRACT_MODEL` | `@cf/meta/llama-3.1-8b-instruct` | LLM structured extract |
| `AUDIT_RETENTION_DAYS` | `90` (max 365) | Retention audit events |

### Bindings (не env vars, но в типе Env)

`MAIL_QUEUE`, `INBOX_WAIT`, `RAW_MIME`, `RATE_LIMIT`, `AI`, `ASSETS` — см. таблицу bindings.

### Клиент / тесты (.env и shell)

| Переменная | Required | Default | Описание |
|------------|----------|---------|----------|
| `MAILAGENT_API_KEY` | да (prod tests) | — | Team key `ma_…` или legacy `API_KEY` |
| `MAILAGENT_API_URL` | нет | `https://api.webmailagent.com` | Base URL API |
| `API_KEY` | fallback | — | Алиас для `MAILAGENT_API_KEY` |
| `SMOKE_EXPECT_ATTACHMENTS` | нет | — | `"1"` в CI для smoke:agent attachments path |
| `CONTRACT_CALLBACK_URL` | нет | — | HTTPS URL для contract-qa-callback |

Загрузка: `scripts/load-env.mjs` подхватывает `.env` для npm scripts.

### GitHub Actions secrets

| Secret | Required | Назначение |
|--------|----------|------------|
| `CLOUDFLARE_API_TOKEN` | да (deploy) | Token с **Workers Scripts Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | да (deploy) | `42ae092824ce3429ee3f914b43603273` |
| `MAILAGENT_API_KEY` | **да (gate)** | CI key для smoke + contract |
| `DATABASE_URL` | нет | Auto `db:migrate` на deploy |
| `PYPI_API_TOKEN` | нет | PyPI `mailagent-agent` на tag `v*` |

---

## CI/CD workflows

Шесть workflow в `.github/workflows/` (Node 22, `npm ci` везде где указано).

| # | Файл | Триггер | Действия | Secrets |
|---|------|---------|----------|---------|
| 1 | `deploy-worker.yml` | `push` → `main` (path filter: `src/`, `public/`, `migrations/`, `wrangler.jsonc`, lockfile, contract scripts, skills); `workflow_dispatch` | `check` → `verify:codex` → optional `db:migrate` → `wrangler deploy` → **`test:prod:gate`** | `CLOUDFLARE_*`, `MAILAGENT_API_KEY`; opt. `DATABASE_URL` |
| 2 | `qa-smoke.yml` | PR → `main`; `push` → `qa/**` | `check` → `build:qa` → `verify:codex` → **`test:prod:gate`** → pilot starter guards | `MAILAGENT_API_KEY` |
| 3 | `security-baseline.yml` | push/PR `main`; cron пн 06:00 UTC; `workflow_dispatch` | `doctor:security`; weekly `check:catalog-prs` | только `GITHUB_TOKEN` |
| 4 | `hol-plugin-scanner.yml` | push/PR `main` | HOL scanner `examples/codex/plugin`, min score 80, SARIF | — |
| 5 | `publish-packages.yml` | tag `v*`; `workflow_dispatch` | `publish:check` → Playwright install → **`test:prod`** → npm/PyPI publish (OIDC) | `MAILAGENT_API_KEY`; opt. `PYPI_API_TOKEN` |
| 6 | `test-prod-full.yml` | только `workflow_dispatch` | Playwright install → **`test:prod`** | `MAILAGENT_API_KEY` |

**Сводка по событиям:** PR → qa-smoke + security + hol (`test:prod:gate`). Push main (Worker paths) → deploy + gate. Tag `v*` → full `test:prod` + publish. Manual → test-prod-full.

Изменения только в `docs/` / `scripts/` без Worker paths **не** триггерят deploy (см. path filter в `deploy-worker.yml`).

---

## Testing matrix

Матрица из [AGENTS.md](../../AGENTS.md) и [docs/AUTOTESTS.md](../../docs/AUTOTESTS.md).

### По слоям

| Слой | npm script | Где запускать | API key | DATABASE_URL |
|------|------------|---------------|---------|--------------|
| **Prod gate (CI light)** | `test:prod:gate` | deploy, PR | да | нет |
| **Prod gate (full)** | `test:prod` | pre-merge, tag `v*` | да | нет |
| **Smoke agent** | `smoke:agent` | MCP, OAuth, DCR, Streamable HTTP | да | нет |
| **Smoke QA** | `smoke:qa` | inbox lifecycle на prod | да | нет |
| **Contract (all)** | `test:contract:all` | 17 scripts via simulate | да | нет |
| **Playwright simulate** | `test:pw:simulate` | CI full gate | да | нет |
| **Typecheck** | `check` | PR, локально | нет | нет |
| **Codex scaffold** | `verify:codex` | PR | нет | нет |
| **Unit (local)** | `test:allowlist`, `test:extract`, … | dev machine | нет | нет |

### Doctor commands

| Команда | Назначение |
|---------|------------|
| `npm run doctor` | Локальная среда: `.dev.vars`, DB ping, webhook hints |
| `npm run doctor:qa` | QA consumer: prod `/health`, `/v1/me`, `/v1/agent` |
| `npm run doctor:billing` | Stripe readiness (local + prod `/v1/me`) |
| `npm run doctor:security` | Trust docs, npm audit (CI: security-baseline) |
| `npm run doctor:operator` | Чеклист оператора |
| `npm run doctor:oidc` | OIDC / Auth0 конфигурация |

### После изменения кода → какой тест

| Изменили | Запустить |
|----------|-----------|
| `src/routes/agent.ts`, MCP hub | `npm run test:contract:qa:agent` |
| inbox / simulate / extract | `npm run test:contract:qa` |
| attachments / raw MIME | `npm run test:contract:qa:attachments` |
| team keys / dashboard | `npm run test:contract:qa:team-keys` |
| billing / Stripe routes | `npm run test:contract:qa:billing` |
| что угодно перед merge | `npm run test:prod` (CI на deploy: `test:prod:gate`) |

### Порядок full prod gate (`test:prod`)

1. `smoke:agent` — discovery, OAuth metadata, DCR, MCP session, tool call
2. `smoke:qa` — create → simulate → wait → extract → delete
3. `test:contract:all` — все contract-qa scripts
4. `test:pw:simulate` — Playwright simulate gate

Любой шаг с ненулевым exit code останавливает pipeline.

Playwright: `examples/playwright/playwright.simulate.config.ts` (gate), product E2E — [docs/QA.md](../../docs/QA.md). Unit-тесты (`test:allowlist`, `test:extract`, …) — только локально, без API key.

---

## Contract test scripts

Все `scripts/contract-qa*.mjs`. Общие требования: `MAILAGENT_API_KEY` (+ опционально `MAILAGENT_API_URL`; оркестраторы форсят prod). Библиотека: `scripts/lib/contract-api.mjs` (`contractApi`, `contractSimulate`, `contractHeaders`).

### Полная таблица scope

Порядок в `test:contract:all` — [scripts/test-contract-all.mjs](../../scripts/test-contract-all.mjs) (17 скриптов, последовательно, fail-fast).

| Файл | npm script | Scope / что проверяет |
|------|------------|------------------------|
| `contract-qa.mjs` | `test:contract:qa` | Базовый flow: create → simulate OTP → wait → extract → delete |
| `contract-qa-agent.mjs` | `test:contract:qa:agent` | `GET /v1/agent`, `/v1/me`, `/mcp/auth` — discovery hub |
| `contract-qa-session.mjs` | `test:contract:qa:session` | Run session memory: `GET/PATCH /v1/agent/runs/:runId/session` |
| `contract-qa-oidc.mjs` | `test:contract:qa:oidc` | OIDC discovery + authorize redirect; **skip** если OIDC выключен |
| `contract-qa-billing.mjs` | `test:contract:qa:billing` | Billing shape; checkout 503 без Stripe; без live payment |
| `contract-qa-callback.mjs` | `test:contract:qa:callback` | `callbackUrl` + simulate → poll `/callbacks` |
| `contract-qa-attachments.mjs` | `test:contract:qa:attachments` | Simulate с attachment → list + meta + raw MIME path |
| `contract-qa-threads.mjs` | `test:contract:qa:threads` | Threading via In-Reply-To + Re: subject |
| `contract-qa-outbound.mjs` | `test:contract:qa:outbound` | Outbound send (нужен verified `OUTBOUND_FROM` на prod) |
| `contract-qa-domains.mjs` | `test:contract:qa:domains` | Custom domains API; cleanup; skip при Resend quota |
| `contract-qa-search.mjs` | `test:contract:qa:search` | Keyword search через simulate (без Workers AI) |
| `contract-qa-extract.mjs` | `test:contract:qa:extract` | Structured extract presets (rules-based) |
| `contract-qa-console.mjs` | `test:contract:qa:console` | `GET /v1/console/summary` + usage meters |
| `contract-qa-audit.mjs` | `test:contract:qa:audit` | Audit log: `inbox.created` после POST (async poll) |
| `contract-qa-console-inbox.mjs` | `test:contract:qa:console-inbox` | Console inbox detail с messages после simulate |
| `contract-qa-team-keys.mjs` | `test:contract:qa:team-keys` | Team key invite + revoke (нужен team admin key) |
| `contract-qa-dedicated-resend.mjs` | `test:contract:qa:dedicated-resend` | Dedicated Resend discovery (без реальных team Resend keys) |

### Запуск одного контракта

```bash
MAILAGENT_API_KEY=ma_… npm run test:contract:qa:agent
```

Billing, OIDC, outbound в `package.json` уже с `MAILAGENT_API_URL=https://api.webmailagent.com`.

Новый contract: копия `contract-qa.mjs` → `lib/contract-api.mjs` → регистрация в `test-contract-all.mjs` + `package.json` + docs. **Без** `DATABASE_URL` / `simulate-inbound.mjs` в CI.

### Диагностика падений

1. Читать stderr последнего скрипта (`--- contract-qa-….mjs ---`)
2. Перезапустить **один** скрипт с тем же ключом
3. Inbox flow: `mailagent_diagnose_inbox` или curl simulate
4. Audit: async — contract уже poll; при flakiness увеличить delay
5. Domains: Resend quota → skip, не регрессия API

```bash
npm run doctor:qa
curl -s -H "Authorization: Bearer $MAILAGENT_API_KEY" \
  https://api.webmailagent.com/v1/agent | jq .
```

---

## Operator vs agent responsibilities

Разделение из [docs/OPERATOR.md](../../docs/OPERATOR.md) и [AGENTS.md](../../AGENTS.md).

### Оператор (человек) — один раз

**GitHub Actions secrets:**

| Secret | Зачем |
|--------|-------|
| `CLOUDFLARE_API_TOKEN` | Deploy Worker |
| `CLOUDFLARE_ACCOUNT_ID` | Deploy Worker |
| `MAILAGENT_API_KEY` | Post-deploy smoke + contract |
| `DATABASE_URL` | опционально — auto migrate на deploy |
| `PYPI_API_TOKEN` | опционально — PyPI на tag `v*` |

**Cloudflare Worker secrets:**

```bash
npx wrangler secret put DATABASE_URL
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put RESEND_WEBHOOK_SECRET
npx wrangler secret put API_KEY
npx wrangler secret put INBOX_DOMAIN
# + опционально OUTBOUND_FROM, OIDC_*, STRIPE_*
```

**Прочее:**

- Resend webhook URL на prod
- Custom domain `api.webmailagent.com`
- npm Trusted Publishing (уже настроено для `@mailagent/*`)
- Релиз: `git tag v0.x.0 && git push origin v0.x.0`

Чеклист: `npm run doctor:operator`, [docs/YOUR-TURN.md](../../docs/YOUR-TURN.md).

Ключ для CI: legacy `API_KEY` из wrangler **или** `npm run issue:key:db -- ci-gate` / `npm run issue:pilot-key`.

**Оператор НЕ проверяет OTP вручную** — только следит, что CI зелёный.

### Агент (Cursor / Codex / CI bot) — постоянно

1. Читать `AGENTS.md`, `docs/AUTOTESTS.md`, `GET /v1/agent`
2. После изменений: узкий `test:contract:qa:*` или полный `test:prod`
3. MCP: `@mailagent/mcp` или remote `POST /mcp`
4. Verify flow: `mailagent_verify_signup` / `POST /v1/agent/verify`
5. При падении: `mailagent_diagnose_inbox`, `npm run doctor:qa`

### Что автоматизировано без оператора

| Событие | Действие |
|---------|----------|
| Push `main` (Worker paths) | deploy → `test:prod:gate` |
| PR / `qa/**` | check + verify:codex + gate + pilot starters |
| Tag `v*` | full test:prod → npm/PyPI publish |
| Weekly | security doctor + catalog PR status |

### Если CI красный

1. Actions → failed run → шаг Contract QA / Smoke
2. Локально: `npm run test:prod` с тем же `MAILAGENT_API_KEY`
3. `npm run doctor:qa` — plan, outbound, oidc hints

---

## Monitoring

### Health endpoints (без auth)

| Endpoint | Ответ | Назначение |
|----------|-------|------------|
| `GET /health` | `{ status, db, version, webhook }` | Liveness + DB probe; 503 если DB недоступна |
| `GET /status` | `{ status, db, version, service, checkedAt, docs, health }` | Публичный uptime page |

Пример:

```bash
curl -s https://api.webmailagent.com/health | jq .
curl -s https://api.webmailagent.com/status | jq .
```

### Authenticated stats

`GET /v1/stats` (Bearer) — usage counters из Postgres:

- Active inboxes, messages 24h
- `keysConfigured`, limits (`defaultTtlMinutes`, `rateLimitPerMinute`, `rateLimitEnabled`)

```bash
curl -s -H "Authorization: Bearer $MAILAGENT_API_KEY" \
  https://api.webmailagent.com/v1/stats | jq .
```

`GET /v1/me` — plan + limits + capabilities (outbound, billing) для текущего ключа.

### Queue DLQ

- Основная очередь: `mailagent-email`
- Dead letter: `mailagent-email-dlq`
- Config: `max_retries: 5` в `wrangler.jsonc`

**Мониторинг DLQ — ручной** через Cloudflare Dashboard → Queues. Сообщения в DLQ = failed ingest (письмо не попало в inbox). Автоалерт в репозитории не настроен (см. `context-os/audit/risks.md`).

При подозрении на потерю почты:

1. Dashboard → Queues → `mailagent-email-dlq` → depth
2. Workers Logs → consumer errors
3. `GET /v1/inboxes/:id/diagnose` для конкретного inbox

### Logs

- **Cloudflare Dashboard** → Workers → `mailagent` → Logs (Real-time / Logpush)
- Cron purge: hourly — искать ошибки в scheduled handler
- Webhook: `POST /webhooks/resend` — ошибки подписи / queue send

### Discovery для агентов

```bash
curl -s -H "Authorization: Bearer $MAILAGENT_API_KEY" \
  https://api.webmailagent.com/v1/agent | jq .
```

Возвращает `mcpTools`, `auth.oidc`, `remoteMcp`, `docs`.

### CI как monitoring

Зелёный `deploy-worker` + `test:prod:gate` = минимальная prod sanity после каждого deploy. Full `test:prod` — глубже, но реже.

---

## Common deploy failures and fixes

### Missing `CLOUDFLARE_API_TOKEN` (CI exit 1)

**Симптом:**

```
In a non-interactive environment, it's necessary to set a CLOUDFLARE_API_TOKEN
```

**Причина:** `wrangler deploy` в Actions без токена. Не связано с `verify:codex`.

**Fix:**

1. GitHub → Settings → Secrets → Actions
2. `CLOUDFLARE_API_TOKEN` (Workers Scripts **Edit**)
3. `CLOUDFLARE_ACCOUNT_ID` = `42ae092824ce3429ee3f914b43603273`
4. Re-run Deploy Worker

Локально: `npx wrangler login` + `npm run deploy`.

### Missing `MAILAGENT_API_KEY` (gate fails)

**Симптом:** `::error::Set MAILAGENT_API_KEY in GitHub Actions secrets`

**Fix:**

1. Создать CI key: `npm run issue:pilot-key -- my-slug` (локально с DATABASE_URL) или использовать team key
2. Добавить в GitHub Secrets как `MAILAGENT_API_KEY`
3. Re-run workflow

Без ключа deploy **намеренно** падает.

### Custom domain 522

**Симптом:** `api.webmailagent.com` недоступен, 522 от Cloudflare.

**Причина:** CNAME на `*.workers.dev` вместо Workers Custom Domain.

**Fix:** Dashboard → Workers → Custom Domains → `api.webmailagent.com`; удалить неверный CNAME.

### `routes` / zone mismatch в wrangler.jsonc

**Симптом:** deploy error про zone / route.

**Fix:** DNS zone в том же CF account, или убрать `routes` block и привязать домен через Dashboard.

### R2 bucket not found

**Симптом:** Worker error на ingest raw MIME.

**Fix:**

```bash
npx wrangler r2 bucket create mailagent-raw-mime
npm run deploy
```

R2 должен быть включён в Dashboard.

### DB migrate skipped in CI

**Симптом:** новая миграция не применена на prod.

**Причина:** `DATABASE_URL` не в GitHub Secrets — шаг migrate пропущен.

**Fix:** Добавить `DATABASE_URL` в Actions secrets **или** вручную `npm run db:migrate` с prod connection string после deploy.

### Resend webhook не доставляет (prod)

**Симптом:** реальные письма не приходят; simulate работает.

**Fix:**

1. Resend → Webhooks → URL = `https://api.webmailagent.com/webhooks/resend`
2. `RESEND_WEBHOOK_SECRET` совпадает с Resend signing secret
3. `GET /health` → поле `webhook` для sanity

### Contract test flaky (audit, domains)

| Тест | Причина | Действие |
|------|---------|----------|
| `contract-qa-audit` | Async write | Re-run; увеличить poll в скрипте |
| `contract-qa-domains` | Resend domain quota | Cleanup в Resend; skip ожидаем |
| `contract-qa-oidc` | OIDC не настроен | Skip — не регрессия |
| `contract-qa-outbound` | Нет `OUTBOUND_FROM` | Настроить secret или ожидать skip/fail |

### Typecheck fails before deploy

**Симптом:** `npm run check` красный в CI.

**Fix:** `npm run check` локально, исправить TS errors в `src/`.

### HOL scanner score < 80

**Симптом:** `hol-plugin-scanner.yml` fail на PR.

**Fix:** Обновить `examples/codex/plugin` по требованиям catalog; `npm run verify:codex`.

### Playwright missing in full gate

**Симптом:** `test:prod` fail — browser not installed.

**Fix:** `npx playwright install chromium --with-deps` (CI делает автоматически в publish и test-prod-full).

### KV rate limit quota exhaustion

**Симптом:** много gate runs → 429 в тестах.

**Причина:** Light gate специально экономит KV; full suite чаще пишет в `RATE_LIMIT`.

**Fix:** Не гонять `test:prod` на каждый commit; использовать узкие contract scripts; увеличить `RATE_LIMIT_KV_WRITE_EVERY` только осознанно.

---

*Синхронизация: `npm run sync:context-os`. Приоритет источников: `SETUP.md`, `wrangler.jsonc`, `package.json`, workflow YAML, `docs/AUTOTESTS.md`.*

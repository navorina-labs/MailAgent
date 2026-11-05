# Deployment Core — MailAgent

Узкое ядро Context OS для **router hits** по развёртыванию: SETUP checklist, wrangler secrets, Resend webhook, первый deploy, custom domain. Полная карта CI/CD, contract tests, doctor-матрица и decision history по тестам — в каноническом ядре.

**См. также:** [deployment-testing-core.md](./deployment-testing-core.md) — source of truth по workflows, `test:prod`, bindings table, operator/agent split.

---

## Purpose

MailAgent — Cloudflare Worker + Neon + Resend + Queues + DO + R2 + Workers AI. Продукт рассчитан на **автономную верификацию агентами** после однократной настройки секретов оператором.

Это ядро отвечает, когда роутер попал в **deploy** / **wrangler** / **SETUP** / **Resend webhook**, но не нужен полный deployment-testing-core (~800 строк):

1. **Пошаговый SETUP** — Neon, Resend, `.dev.vars`, туннель, deploy.
2. **Wrangler secrets** — обязательные и опциональные, команды `secret put/list`.
3. **Resend webhook** — URL, события, signing secret, team path.
4. **Custom domain** `api.webmailagent.com` — типичные ошибки (522).
5. **Команды** — dev, deploy, migrate, doctor, verify, gate.
6. **Первый deploy side effects** — queues, R2, KV, DO.

Ключевой принцип (кратко): **contract tests на prod без DATABASE_URL** — `POST …/simulate`. Детали — в deployment-testing-core.

---

## Entities

### Wrangler bindings (prod)

| Binding | Тип | Ресурс | Назначение |
|---------|-----|--------|------------|
| `MAIL_QUEUE` | Queue producer | `mailagent-email` | Async inbound после Resend webhook |
| (consumer) | Queue consumer | `mailagent-email` | DLQ `mailagent-email-dlq`, max_retries 5 |
| `INBOX_WAIT` | Durable Object | `InboxWait` | SSE `/events`, wait notify |
| `RAW_MIME` | R2 | `mailagent-raw-mime` | Raw `.eml`, крупные вложения |
| `RATE_LIMIT` | KV | id в wrangler.jsonc | Rate limit per API key |
| `AI` | Workers AI | platform | Search embeddings, extract |
| `ASSETS` | Static | `./public` | Landing, docs, dashboard HTML |

**Cron:** `0 * * * *` — purge expired inboxes + audit retention.

**Vars (non-secret в wrangler.jsonc):** `DEFAULT_TTL_MINUTES`, `RATE_LIMIT_PER_MINUTE`, `RATE_LIMIT_KV_WRITE_EVERY`, `AUDIT_RETENTION_DAYS`.

### Environment tiers

| Tier | Где | Примеры |
|------|-----|---------|
| Worker secrets | wrangler / `.dev.vars` | `DATABASE_URL`, `RESEND_*`, `API_KEY`, `INBOX_DOMAIN` |
| Worker vars | `wrangler.jsonc` | TTL, rate limits, audit retention |
| MCP / tests | `.env` | `MAILAGENT_API_URL`, `MAILAGENT_API_KEY` |
| GitHub Actions | repo secrets | `CLOUDFLARE_*`, `MAILAGENT_API_KEY`, optional `DATABASE_URL` |

### Deploy artifacts

| Artifact | Path |
|----------|------|
| Worker entry | `src/index.ts` |
| Config | `wrangler.jsonc` |
| Static | `public/` |
| Migrations | `migrations/*.sql` |
| MCP package | `mcp/` → `@mailagent/mcp` |

---

## Decision history

| # | Решение | Статус |
|---|---------|--------|
| D1 | Contract tests без DATABASE_URL в CI | active — simulate-only HTTP |
| D2 | Prod gate light после deploy (`test:prod:gate`) | active — не full suite каждый push |
| D3 | Deploy fails без `MAILAGENT_API_KEY` | active — smoke обязателен |
| D4 | Path-filtered deploy workflow | active — только Worker-related paths |
| D5 | Custom domain, не CNAME на workers.dev | active — иначе 522 |
| D6 | `MAILAGENT_API_URL` prod в orchestrators | active — игнор локального 127.0.0.1 |
| D7 | npm Trusted Publishing OIDC на tag `v*` | active — full `test:prod` перед publish |
| D8 | Локальный Resend webhook требует HTTPS tunnel | active — иначе только simulate/prod |

Детальные обоснования и workflow names — [deployment-testing-core.md § Decision history](./deployment-testing-core.md).

---

## Sources

| Document | Path |
|----------|------|
| Manual setup | [SETUP.md](../../SETUP.md) |
| Operator secrets | [docs/OPERATOR.md](../../docs/OPERATOR.md) |
| CI secrets & workflows | [docs/CI.md](../../docs/CI.md) |
| Autotests matrix | [docs/AUTOTESTS.md](../../docs/AUTOTESTS.md) |
| Agent autonomy | [AGENTS.md](../../AGENTS.md) |
| Wrangler config | [wrangler.jsonc](../../wrangler.jsonc) |
| Env type | [src/env.ts](../../src/env.ts) |
| Secrets template | [.dev.vars.example](../../.dev.vars.example) |
| Raw MIME R2 | [docs/RAW-MIME-R2.md](../../docs/RAW-MIME-R2.md) |
| Hosting | [docs/HOSTING-CLOUDFLARE.md](../../docs/HOSTING-CLOUDFLARE.md) |

---

## SETUP checklist (полный цикл)

Worker уже может работать локально (`npm run dev`). **Полный цикл** требует 3 внешних сервиса + секреты.

### Phase 0 — Prerequisites

- [ ] Node.js 22+ (как в CI)
- [ ] `git clone` + `npm install`
- [ ] Аккаунт Cloudflare (для deploy)
- [ ] Аккаунт Neon
- [ ] Аккаунт Resend

### Phase 1 — Neon Postgres (~5 min)

1. [neon.tech](https://neon.tech) → New project
2. **Connect** → включить **Connection pooling**
3. Copy connection string → `DATABASE_URL` в `.dev.vars`
4. Опционально: убрать `&channel_binding=require` если driver падает
5. Password: **Show password** → подставить в строку

```bash
DATABASE_URL="postgresql://..." npm run db:migrate
```

**Проверка:** `npm run doctor` — DB ping.

### Phase 2 — Resend (~10 min)

1. [resend.com](https://resend.com) → API Keys → `RESEND_API_KEY=re_…`
2. **Emails → Receiving** → домен вида `abc123.resend.app` → `INBOX_DOMAIN=abc123.resend.app`
3. **Webhooks** → событие `email.received` → URL (см. § Resend webhook ниже)
4. Signing secret → `RESEND_WEBHOOK_SECRET=whsec_…`

### Phase 3 — Local secrets

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

**Проверка:**

```bash
node scripts/setup-check.mjs   # npm run setup:check
npm run dev                  # terminal 1 — :8787
npm run verify               # terminal 2 — local smoke
```

### Phase 4 — Cursor MCP (опционально)

```bash
npm run build:mcp
```

Settings → MCP → `mailagent` → Refresh tools. Config: `.cursor/mcp.json` → `node mcp/dist/index.js`.

### Phase 5 — Production deploy (manual first time)

```bash
npx wrangler login

npx wrangler secret put DATABASE_URL
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put RESEND_WEBHOOK_SECRET
npx wrangler secret put API_KEY
npx wrangler secret put INBOX_DOMAIN

# Dashboard → R2 → enable, затем:
npx wrangler r2 bucket create mailagent-raw-mime

npm run deploy
npm run db:migrate
```

### Phase 6 — Post-deploy

- [ ] Обновить Resend webhook URL на prod (см. ниже)
- [ ] `curl https://api.webmailagent.com/health` (или workers.dev до custom domain)
- [ ] `MAILAGENT_API_URL` в `.env` → prod URL
- [ ] GitHub Actions: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `MAILAGENT_API_KEY` — [OPERATOR.md](../../docs/OPERATOR.md)

### Phase 7 — Custom domain (optional)

`api.webmailagent.com` — см. § Custom domain. Лендинг `webmailagent.com` — отдельно (Netlify).

---

## Wrangler secrets (справочник)

### Просмотр имён (не значений)

```bash
npx wrangler secret list
```

### Обязательные (минимальный prod)

| Secret | Описание | Пример формата |
|--------|----------|----------------|
| `DATABASE_URL` | Neon pooled connection string | `postgresql://…?sslmode=require` |
| `RESEND_API_KEY` | Resend API key | `re_…` |
| `RESEND_WEBHOOK_SECRET` | Svix signing secret для `/webhooks/resend` | `whsec_…` |
| `API_KEY` или `API_KEYS` | Master / legacy keys (comma-separated) | произвольная строка или `ma_…` |
| `INBOX_DOMAIN` | Resend receiving domain | `abc123.resend.app` |

### Опциональные (по фичам)

| Secret | Когда нужен |
|--------|-------------|
| `OUTBOUND_FROM` | Send/reply из console/API |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_AUDIENCE` | Browser login MCP (Auth0) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO` | Pro billing self-serve |
| `MCP_OAUTH_JWT_SECRET` | JWT для `mat_*` (default: fallback `API_KEY`) |
| `MCP_OAUTH_TOKEN_TTL_SEC` | TTL OAuth token (300–86400, default 3600) |
| `TEAM_SECRETS_KEY` | Шифрование dedicated Resend cipher в `teams` |

### Команды put / delete

```bash
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret delete STRIPE_SECRET_KEY   # осторожно — prod impact
```

### Локальная разработка

Секреты Worker при `npm run dev` читаются из **`.dev.vars`** (не коммитить). MCP client — из **`.env`**.

**Никогда в git:** `.dev.vars`, `.env`, реальные `whsec_`, `re_`, `ma_` plaintext.

---

## Resend webhook setup

### Global inbound (shared Resend account)

| Параметр | Значение |
|----------|----------|
| Event | `email.received` |
| Method | POST |
| **Local URL** | `https://<tunnel-host>/webhooks/resend` |
| **Prod URL** | `https://api.webmailagent.com/webhooks/resend` |
| Signing secret | → `RESEND_WEBHOOK_SECRET` |

**Flow:** verify Svix headers → enqueue `MAIL_QUEUE` → fast 200. Consumer: `src/services/resend-mail.ts`.

**Код:** `src/routes/webhooks.ts` — `resend.webhooks.verify` с headers `svix-id`, `svix-timestamp`, `svix-signature`.

### Локальный туннель

Worker на `127.0.0.1:8787` недоступен Resend напрямую:

```bash
# Terminal 1
npm run dev

# Terminal 2 — cloudflared example
cloudflared tunnel --url http://127.0.0.1:8787
# Copy https://….trycloudflare.com/webhooks/resend → Resend dashboard
```

Без туннеля локально работают **simulate** и contract-тесты против prod API; реальный inbound — только tunnel или prod.

### Enterprise per-team webhook

| Параметр | Значение |
|----------|----------|
| Path | `POST /webhooks/resend/team/:teamId` |
| Secret | Из `teams.dedicated_resend_webhook_secret_cipher` (016) |
| API key | Per-team Resend из cipher |
| Plan | `enterprise` + dedicated Resend configured |

Wrong `teamId` или не configured → 404 `dedicated_resend_not_configured`. Invalid signature → 401.

### После deploy — обязательно

1. Открыть Resend → Webhooks
2. Заменить tunnel URL на `https://api.webmailagent.com/webhooks/resend`
3. Re-test: отправить письмо на test inbox или `npm run smoke:qa` на prod

### Stripe webhook (optional)

`POST /webhooks/stripe` — disabled until `STRIPE_WEBHOOK_SECRET` set. Signature via Stripe SDK. См. [docs/STRIPE-SETUP.md](../../docs/STRIPE-SETUP.md).

---

## Local development

```bash
git clone https://github.com/navorina-labs/MailAgent.git
cd MailAgent
npm install

cp .dev.vars.example .dev.vars
cp .env.example .env
# fill DATABASE_URL, RESEND_*, API_KEY, INBOX_DOMAIN

DATABASE_URL="postgresql://..." npm run db:migrate

npm run dev          # Worker :8787
npm run verify       # local smoke in another terminal
```

| Command | Purpose |
|---------|---------|
| `npm run dev` | `wrangler dev` local Worker |
| `npm run verify` | Local smoke (needs running dev) |
| `npm run setup:check` | Validate `.dev.vars` / `.env` |
| `npm run doctor` | Env + DB + optional prod probe |
| `npm run doctor:qa` | Prod API only (no local DB) |
| `npm run build:mcp` | Build stdio MCP |
| `npm run types` | Generate wrangler types |
| `npm run check` | TypeScript |

---

## Production deploy

### Стандартный deploy

```bash
npm run deploy
# alias: npx wrangler deploy
```

### CI deploy (automatic)

Push to `main` с изменениями в `src/`, `public/`, `migrations/`, `wrangler.jsonc`, `package-lock.json`, contract scripts → `.github/workflows/deploy-worker.yml`:

1. `wrangler deploy`
2. Optional `npm run db:migrate` if `DATABASE_URL` secret
3. `npm run test:prod:gate` — **fails without** `MAILAGENT_API_KEY`

### First deploy side effects

Автоматически создаётся/привязывается:

- Queue `mailagent-email` + DLQ `mailagent-email-dlq`
- KV namespace `RATE_LIMIT`
- R2 bucket `mailagent-raw-mime` (если создан заранее)
- Durable Object `InboxWait` (migration tag `v1` в wrangler)
- Workers AI binding
- Static assets from `public/`

### Post-deploy verification

```bash
# Light gate (~15 API calls)
MAILAGENT_API_URL=https://api.webmailagent.com \
MAILAGENT_API_KEY=ma_… \
  npm run test:prod:gate

# Full gate before merge / release
MAILAGENT_API_URL=https://api.webmailagent.com \
MAILAGENT_API_KEY=ma_… \
  npm run test:prod
```

---

## Custom domain `api.webmailagent.com`

**Landing:** `webmailagent.com` (Netlify static).  
**API:** Worker Custom Domain — **не** CNAME на `*.workers.dev` (ошибка **522**).

### Вариант A — Dashboard

1. Workers & Pages → Worker `mailagent` → Settings → Domains & Routes
2. Add Custom Domain → `api.webmailagent.com`
3. Cloudflare создаёт/обновляет DNS
4. Удалить старый CNAME на workers.dev если есть

### Вариант B — CLI

```bash
npm run deploy
npx wrangler domains add api.webmailagent.com
```

### Проверка

```bash
curl https://api.webmailagent.com/health
```

Обновить:

- Resend webhook URL
- `MAILAGENT_API_URL=https://api.webmailagent.com` в `.env`, MCP, CI

**Troubleshooting:** deploy fails из-за `routes` в wrangler — zone DNS в том же Cloudflare account, или убрать `routes` и attach domain через Dashboard.

---

## GitHub Actions secrets (operator)

| Secret | Required | Purpose |
|--------|----------|---------|
| `CLOUDFLARE_API_TOKEN` | yes | Deploy Worker |
| `CLOUDFLARE_ACCOUNT_ID` | yes | Deploy Worker |
| `MAILAGENT_API_KEY` | **yes** | Post-deploy smoke + contract |
| `DATABASE_URL` | optional | Auto migrate on deploy |
| `PYPI_API_TOKEN` | optional | Python package on tag `v*` |

Ключ для CI: team key (`npm run issue:key:db -- ci-gate`) или legacy `API_KEY`. Без `MAILAGENT_API_KEY` deploy **красный по дизайну**.

---

## npm scripts (deploy-related)

| Script | When to run |
|--------|-------------|
| `npm run deploy` | Ship Worker to prod |
| `npm run db:migrate` | After schema change / first Neon setup |
| `npm run test:prod:gate` | Post-deploy / CI light check |
| `npm run test:prod` | Before merge, full contracts + Playwright |
| `npm run test:contract:all` | All 17 contract-qa scripts |
| `npm run smoke:qa` | Prod API lifecycle smoke |
| `npm run smoke:agent` | MCP + OAuth smoke |
| `npm run issue:key:db` | Create team API key (needs DATABASE_URL) |
| `npm run issue:pilot-key` | Scoped CI key |
| `npm run wizard:qa-pilot` | Onboarding QA consumer |

**После изменения кода** — см. таблицу в [AGENTS.md](../../AGENTS.md): agent routes → `test:contract:qa:agent`, billing → `test:contract:qa:billing`, etc.

---

## R2 bucket `mailagent-raw-mime`

- Binding `RAW_MIME` в `wrangler.jsonc`
- Create: `npx wrangler r2 bucket create mailagent-raw-mime`
- Лимиты (env): `RAW_MIME_MAX_BYTES` (15MB), `RAW_MIME_AGENT_MAX_BYTES` (512KB), `ATTACHMENT_MAX_STORE_BYTES` (2MB)
- Docs: [RAW-MIME-R2.md](../../docs/RAW-MIME-R2.md)

---

## npm package publish

Tag `v*` → `publish-packages.yml` → `@mailagent/mcp`, `@mailagent/agent`, `@mailagent/qa` via npm Trusted Publishing (OIDC).

Перед tag: full `npm run test:prod` с Playwright.

---

## Troubleshooting

| Симптом | Вероятная причина | Действие |
|---------|-------------------|----------|
| 522 на api.* | CNAME → workers.dev | Custom Domain в Dashboard |
| Deploy OK, no email | Webhook still tunnel URL | Update Resend webhook to prod |
| `invalid_signature` 401 | Wrong `RESEND_WEBHOOK_SECRET` | Re-copy whsec from Resend |
| Contract fails 401 | Wrong/expired `MAILAGENT_API_KEY` | `doctor:qa`, re-issue key |
| Migrate skipped in CI | No `DATABASE_URL` secret | Run `db:migrate` locally or add secret |
| Local dev no inbound | No tunnel | cloudflared или test prod only |
| R2 errors on ingest | Bucket missing | `wrangler r2 bucket create` |
| Rate limit 429 in gate | Too many CI runs | Wait or use dedicated CI key |

---

## Operator vs agent responsibilities

| Who | Does |
|-----|------|
| **Operator (human)** | One-time secrets: wrangler, GitHub Actions, Stripe, OIDC — [OPERATOR.md](../../docs/OPERATOR.md) |
| **Agent (Cursor/Codex)** | `test:prod`, contract-qa, MCP verify — **без** human OTP |
| **CI** | Deploy + `test:prod:gate` on main; PR checks |

Агент **не** должен просить DATABASE_URL для smoke/contract — только `MAILAGENT_API_URL` + `MAILAGENT_API_KEY`.

---

## wrangler.jsonc quick reference

```jsonc
{
  "name": "mailagent",
  "main": "src/index.ts",
  "compatibility_date": "2026-01-15",
  "compatibility_flags": ["nodejs_compat_v2"],
  "vars": { "DEFAULT_TTL_MINUTES": "30", ... },
  "kv_namespaces": [{ "binding": "RATE_LIMIT", ... }],
  "queues": { "producers": [...], "consumers": [...] },
  "durable_objects": { "bindings": [{ "name": "INBOX_WAIT", "class_name": "InboxWait" }] },
  "triggers": { "crons": ["0 * * * *"] },
  "r2_buckets": [{ "binding": "RAW_MIME", "bucket_name": "mailagent-raw-mime" }],
  "ai": { "binding": "AI" },
  "assets": { "directory": "./public", "binding": "ASSETS", "run_worker_first": true }
}
```

Полная таблица bindings — [deployment-testing-core.md § wrangler.jsonc](./deployment-testing-core.md).

---

## See also

- **[deployment-testing-core.md](./deployment-testing-core.md)** — CI workflows, contract matrix, test:prod layers, decision history, doctor commands
- [database-core.md](./database-core.md) — migrations, `npm run db:migrate`
- [security-core.md](./security-core.md) — webhook auth, secrets hygiene
- [SETUP.md](../../SETUP.md) — canonical manual setup
- [OPERATOR.md](../../docs/OPERATOR.md) — GitHub + Worker secrets checklist
- [AUTOTESTS.md](../../docs/AUTOTESTS.md) — prod verification guide
- [AGENTS.md](../../AGENTS.md) — agent autonomy commands

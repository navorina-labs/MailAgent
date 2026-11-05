# MailAgent roadmap

**v0.5**

## Agent ✅

| Remote MCP `/mcp` | ✅ |
| Streamable HTTP (Mcp-Session-Id + SSE GET) | ✅ |
| OAuth client_credentials (`mat_` tokens) | ✅ |
| Dynamic Client Registration (RFC 7591) | ✅ |
| OIDC IdP (Auth0/Google authorization_code) | ✅ |
| Scoped API keys (labelPrefix, readOnly) | ✅ |
| Raw MIME in R2 (.eml archive) | ✅ |
| Progress notifications on wait | ✅ |
| RFC 8414 / 9728 discovery | ✅ |
| `runId` tracing | ✅ |
| `GET /v1/agent/runs` + UI | ✅ |
| `npm run smoke:agent` | ✅ |
| `@mailagent/agent` SDK | ✅ |

## QA ✅

P0–P2 done — see [QA-ROADMAP.md](./QA-ROADMAP.md).

## Publish ✅

| Package | Version (npm) |
|-------|----------------|
| `@mailagent/mcp` | 0.2.5 |
| `@mailagent/qa` | 0.1.17 |
| `@mailagent/agent` | 0.1.13 |

```bash
npm install @mailagent/mcp @mailagent/qa @mailagent/agent
```

Re-release: [PUBLISH.md](./PUBLISH.md) · CI: workflow **Publish npm packages** (OIDC Trusted Publishing, tag `v*`).

## CI ✅

Deploy on push `main`: [CI.md](./CI.md) — `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, **`MAILAGENT_API_KEY`** (prod gate).

**KV free tier:** rate limit uses sampled writes (`RATE_LIMIT_KV_WRITE_EVERY=10`). CI deploy uses `test:prod:gate` (smoke only); full `test:prod` on tag `v*` or manual. OIDC browser login uses stateless JWT (no KV puts).

## v0.6 Agent

| MCP `mailagent_list_messages` | ✅ |
| MCP `mailagent_get_raw_message` | ✅ |
| Verify response `hasRaw` + `rawUrl` | ✅ |
| `@mailagent/agent` getProfile, listMessages, getRawMessageMeta | ✅ |

## v0.7 Attachments

| REST list/download attachments | ✅ |
| MCP `mailagent_list_attachments` / `mailagent_get_attachment` | ✅ |
| R2 cache for small attachments (≤2MB) | ✅ |
| Verify `hasAttachments` + `attachmentCount` | ✅ |

## Next (QA / Developer track)

### v0.8 QA relief ✅

| `@mailagent/qa` 0.1.8+ debug + attachments + messageIndex | ✅ |
| Debug UI `?inbox=` + tables | ✅ |
| `npm run smoke:qa` | ✅ |
| [QA-TROUBLESHOOTING.md](./QA-TROUBLESHOOTING.md) | ✅ |
| [QA-LOCAL-SMTP.md](./QA-LOCAL-SMTP.md) + Mailpit compose | ✅ |
| `parse-otp-message` fallback in extract | ✅ |
| Wait Nth message (`messageIndex`) | ✅ |
| Richer 408 + callback `verification` | ✅ |
| `npm run doctor` | ✅ |

### v0.9 ✅

| `waitForCallback` in `@mailagent/qa` | ✅ |
| `getVerification(inboxId, messageId?)` | ✅ |
| Doctor Resend API ping | ✅ |
| CI: `smoke:qa` after deploy | ✅ |
| `GET /v1/agent` mcpTools = manifest | ✅ |
| [QA-RELEASE.md](./QA-RELEASE.md) | ✅ |
| Publish `@mailagent/qa@0.1.9` | ✅ |

### v0.9+ ✅

| PR CI smoke on `qa/*` (`.github/workflows/qa-smoke.yml`) | ✅ |
| Contract + `messageIndex` + callback (`test:contract:qa:callback`) | ✅ |
| Playwright `mailagent-callback.fixture.ts` | ✅ |

### v0.10 ✅

| `@mailagent/agent@0.1.5` — `messageIndex` in verify | ✅ |
| Simulate `--with-attachment`, contract attachments | ✅ |
| Playwright `attachment.spec.example.ts` | ✅ |
| Contract on deploy (optional secrets) | ✅ |
| Publish `@mailagent/agent@0.1.5` | manual (`npm run publish:agent`, org login) |

### v0.11 Codex (plugin + MCP)

| [CODEX.md](./CODEX.md) — plan and setup | ✅ |
| `examples/codex/config.toml.example` (stdio + remote) | ✅ |
| Codex plugin scaffold (`examples/codex/plugin/`) | ✅ |
| Skill `mailagent` for Codex | ✅ |
| `npm run smoke:codex` + `verify:codex` in CI | ✅ |
| Remote OAuth preset | ✅ |
| `AGENTS.md` | ✅ |
| Playwright globalSetup | ✅ |
| Codex CLI manual test | manual |
| Marketplace publish | planned |

### v0.12 Diagnose (QA + agents)

| `GET /v1/inboxes/:id/diagnose` | ✅ |
| MCP `mailagent_diagnose_inbox` | ✅ |
| `@mailagent/qa` getDebugContext → diagnose API | ✅ |
| Debug UI troubleshooting panel | ✅ |
| `npm run doctor:qa` | ✅ |
| Vitest example (`examples/vitest/`) | ✅ |

### v0.13 Jest + publish prep

| Jest example (`examples/jest/`) | ✅ |
| `smoke-codex` local fallback before npm publish | ✅ |
| Publish `@mailagent/mcp@0.2.1` | manual |
| Publish `@mailagent/qa@0.1.10` | manual |

### v0.14 Simulate (QA without DATABASE_URL)

| `POST /v1/inboxes/:id/simulate` | ✅ |
| MCP `mailagent_simulate_message` | ✅ |
| Debug UI "Simulate OTP email" | ✅ |
| `@mailagent/qa` / `@mailagent/agent` simulate + diagnose | ✅ |
| smoke:qa simulate → extract | ✅ |

### v0.15 Contract without DATABASE_URL

| `contract-qa*` via `POST …/simulate` | ✅ |
| CI deploy/qa-smoke: `MAILAGENT_API_KEY` only | ✅ |
| `examples/github-actions/contract-qa.yml` | ✅ |
| `scripts/lib/contract-api.mjs` | ✅ |

### v0.16 Simulate-first QA

| `@mailagent/qa` `simulateAndVerify()` | ✅ |
| Playwright simulate example + fixture | ✅ |
| `examples/github-actions/qa-simulate-only.yml` | ✅ |
| OpenAPI `/diagnose` + `/simulate` | ✅ |
| [QA-SIMULATE.md](./QA-SIMULATE.md) | ✅ |

### v0.17 Outbound + threads (AgentMail parity start)

| `POST /v1/inboxes/:id/send` | ✅ |
| `POST …/messages/:id/reply` | ✅ |
| `GET …/threads`, `GET …/threads/:id/messages` | ✅ |
| MCP `mailagent_send_message`, `mailagent_list_threads` | ✅ |
| Migration `011_outbound_threads.sql` | ✅ |
| [V1-PLATFORM.md](./V1-PLATFORM.md) — full v1.0 plan | ✅ |

### v0.18 Inbound threading

| Parse In-Reply-To / References / Message-ID on ingest | ✅ |
| Re: / Fwd: subject fallback | ✅ |
| `simulate` + `inReplyToMessageId` / `rfcMessageId` | ✅ |
| `contract-qa-threads` + smoke thread grouping | ✅ |
| `npm run test:thread-resolve` | ✅ |

### v0.19 Custom domains (AgentMail parity)

| `POST /v1/domains`, `GET`, `POST …/verify`, `DELETE` | ✅ |
| `POST /v1/inboxes` `{ username, domainId }` | ✅ |
| MCP `mailagent_add_domain`, `mailagent_list_domains`, `mailagent_verify_domain` | ✅ |
| Migration `012_custom_domains.sql` | ✅ |
| `contract-qa-domains` | ✅ |

### v0.21 Semantic search

| `GET /v1/inboxes/:id/search?q=` keyword + semantic | ✅ |
| pgvector `message_search` + Workers AI embeddings | ✅ |
| MCP `mailagent_search_messages` | ✅ |
| `contract-qa-search` | ✅ |

### v0.22 Structured extraction

| `POST …/messages/:id/extract` presets + custom schema | ✅ |
| Presets `2fa`, `invoice`, `receipt` (rules; AI for custom) | ✅ |
| `GET …/extract/presets` | ✅ |
| MCP `mailagent_extract_structured` | ✅ |
| `contract-qa-extract` | ✅ |

### v0.23 Hosted console + billing portal

| `GET /v1/console/summary` (plan, usage, inboxes, domains, team) | ✅ |
| Scoped usage meters (`messagesLast24h`, domains, team keys) | ✅ |
| Extended `GET /v1/me` limits + usage | ✅ |
| `POST /v1/billing/portal` (Stripe Customer Portal) | ✅ |
| Console UI `dashboard.html` | ✅ |
| `contract-qa-console` | ✅ |

### v0.24 Audit log (enterprise prep)

| Migration `014_audit_log` | ✅ |
| `GET /v1/audit` team / key scoped | ✅ |
| Events: inbox, team keys, domains, billing checkout | ✅ |
| Console `recentAudit` in summary + dashboard | ✅ |
| `contract-qa-audit` | ✅ |

### v0.25 Console threads + audit retention

| `GET /v1/console/threads` scoped recent conversations | ✅ |
| `recentThreads` in console summary + dashboard UI | ✅ |
| Audit retention cron (`AUDIT_RETENTION_DAYS`, default 90) | ✅ |
| `policies.auditRetentionDays` in audit + console APIs | ✅ |

### v0.26 Console inbox detail + Codex marketplace pack

| `GET /v1/console/inboxes/:id` messages + threads + callbacks | ✅ |
| `console-inbox.html` hosted inbox view | ✅ |
| Codex plugin v0.2.3 + `npm run package:codex` tarball | ✅ |
| Skill updated (32 MCP tools) | ✅ |
| `contract-qa-console-inbox` | ✅ |

### v0.27 Console send/reply + npm publish prep

| Send / reply forms in `console-inbox.html` | ✅ |
| `outbound` capability in console inbox detail | ✅ |
| Audit `inbox.sent` / `inbox.replied` | ✅ |
| `publish-check` compares local vs npm registry | ✅ |
| Bump `@mailagent/qa@0.1.13`, `@mailagent/agent@0.1.7` | ✅ |

### v0.28 Team keys UI (without Stripe)

| Dashboard: create key form (label, prefix, read-only) | ✅ |
| Dashboard: revoke key + show-once banner | ✅ |
| `team.canManageKeys` in console summary | ✅ |
| `contract-qa-team-keys` | ✅ |
| ROADMAP / PUBLISH OIDC sync | ✅ |

### v0.29 Codex & teams docs

| `public/docs/codex.html` — Codex plugin install + marketplace pack | ✅ |
| `public/docs/teams.html` — team keys without Stripe | ✅ |
| `GET /v1/me` → `capabilities.outbound` | ✅ |
| Codex plugin manifest 0.2.4 | ✅ |
| Dashboard + sidebar nav links | ✅ |

### v0.30 Outbound setup guide

| `public/docs/outbound.html` — Resend + OUTBOUND_FROM | ✅ |
| `capabilities.outbound` in console summary + dashboard banner | ✅ |
| Shared `outboundCapabilities()` in console inbox | ✅ |
| `setup-check` hint + `.env.example` | ✅ |
| agents.html outbound + Codex links | ✅ |

### v0.31 Agent SDK + OIDC docs

| `@mailagent/agent@0.1.8` — full `MeProfile`, `getMcpAuth()`, `getAgentHub()` | ✅ |
| `GET /v1/agent` → `auth.oidc` + docs links | ✅ |
| `public/docs/oauth-idp.html` — Auth0/Google setup | ✅ |
| doctor/smoke — outbound + oidc in output | ✅ |

### v0.32 Operator + prod gate

| `docs/OPERATOR.md` — manual secrets only | ✅ |
| `npm run test:contract:all` + `npm run test:prod` | ✅ |
| CI: `MAILAGENT_API_KEY` required, fail if missing | ✅ |
| `contract-qa-agent` — hub / me / mcp/auth | ✅ |
| AGENTS.md — autonomy + test:prod | ✅ |

### v0.33 Autotests guide for agents

| `docs/AUTOTESTS.md` — full guide | ✅ |
| `public/docs/autotests.html` + sidebar nav | ✅ |
| `GET /v1/agent` → `tests`, `autotests` | ✅ |
| `contract-qa-agent` checks autotests discovery | ✅ |
| AGENTS.md + skills + Codex skill — test:prod workflow | ✅ |

### v0.34 English-only docs and comments

| All `docs/*.md`, code comments, workflow messages → English | ✅ |
| `docs/AUTOTESTS.md`, `OPERATOR.md` | ✅ |

### v0.35 Session memory + Playwright CI + npm

| Migration `015_agent_run_sessions` | ✅ |
| `GET/PATCH /v1/agent/runs/:runId/session` | ✅ |
| MCP `mailagent_get_run_session`, `mailagent_get_run_timeline`, `mailagent_patch_run_session` | ✅ |
| `@mailagent/agent@0.1.9` — getRunSession / patchRunSession | ✅ |
| `@mailagent/mcp@0.2.4` | ✅ |
| `contract-qa-session` + Playwright `simulate-gate.spec.ts` in `test:prod` | ✅ |
| `V1-PLATFORM.md` status sync | ✅ |
| Optional CI `DATABASE_URL` → `db:migrate` on deploy | ✅ |

### v0.35.1 KV put quota (free tier)

| Rate limit: sample KV writes (`RATE_LIMIT_KV_WRITE_EVERY=10`) | ✅ |
| MCP stream progress: no redundant KV relay on `tools/call` SSE | ✅ |
| Prod smoke fallback when KV exhausted | ✅ |

### v0.36 Stateless mat_ JWT + verify session

| `mat_` tokens signed as JWT (HS256, no KV put/get) | ✅ |
| Legacy KV-backed `mat_` still validated | ✅ |
| `POST /v1/agent/verify` auto-patches run session when `runId` set | ✅ |
| Optional `MCP_OAUTH_JWT_SECRET` (default `API_KEY`) | ✅ |

### v0.37 Verify session everywhere

| Session patch inside `runAgentVerify` (REST + MCP) | ✅ |
| MCP `runId` on verify / wait_and_extract | ✅ |
| MCP `create_inbox` → `inbox.created` session step | ✅ |
| API hub `0.8.0` · npm `@mailagent/agent@0.1.10` `@mailagent/mcp@0.2.5` | ✅ |

### v0.38 Stateless MCP sessions + session in verify/run

| MCP `Mcp-Session-Id` as JWT (no KV put on initialize) | ✅ |
| `POST /v1/agent/verify` response includes `session` when `runId` set | ✅ |
| `GET /v1/agent/runs/:runId` includes `session` | ✅ |
| `@mailagent/agent@0.1.11` · API hub `0.8.1` | ✅ |

### v0.39 Agent Skills ecosystem

| Canonical `skills/mailagent/SKILL.md` (Agent Skills spec) | ✅ |
| `npm run sync:skills` → Cursor + Codex plugin copies | ✅ |
| `npm run verify:skills` · [AGENT-SKILLS.md](./AGENT-SKILLS.md) | ✅ |
| Combo flows (verify → Membrane / app skills) documented | ✅ |
| `npx skills add navorina-labs/MailAgent --skill mailagent` | ✅ |
| OIDC contract `test:contract:qa:oidc` (skip if disabled) | ✅ |
| `npm run doctor:oidc` + setup:oidc-prod verify hook | ✅ |
| Catalog submit guide [CATALOG-SUBMIT.md](./CATALOG-SUBMIT.md) | ✅ |
| `npm run prepare:catalog-pr` staging bundle | ✅ |
| awesome-codex-plugins PR | [#195](https://github.com/hashgraph-online/awesome-codex-plugins/pull/195) mergeable, maintainer merge |
| Docs page `/docs/agent-skills.html` | ✅ |

### v0.40 OIDC prod + KV relief

| Auth0 tenant `webmailagent.us.auth0.com` + MailAgent MCP app | ✅ |
| OIDC secrets on Worker (`npm run wizard:auth0 -- --deploy`) | ✅ |
| `auth.oidc: enabled` on prod | ✅ |
| Stateless OIDC flow JWT (authorize state + auth code, no KV puts) | ✅ |
| `npm run wizard:auth0` interactive setup | ✅ |

### v0.40.1 CI KV relief

| `test:prod:gate` — smoke only on deploy/PR (not full contract suite) | ✅ |
| OIDC flow JWT (no KV on browser login) | ✅ |
| `test-prod-full.yml` workflow_dispatch | ✅ |
| `GET /v1/agent` → `tests.prodGateCi` | ✅ |

### v0.41 Domains docs

| `custom-domain.html` — SaaS API + self-host INBOX_DOMAIN | ✅ |
| Resend quota note in domains guide | ✅ |

### v0.42 Console domains UI

| Dashboard: add domain form + DNS banner | ✅ |
| Verify DNS / delete domain buttons | ✅ |
| `enterprise.html` + sidebar link | ✅ |

### v0.43 Landing + SOC2 draft

| Landing: OIDC + console feature cards, CTA dashboard link | ✅ |
| `GET /v1/agent` → `console`, `enterprise` URLs | ✅ |
| `docs/SOC2.md` control mapping draft | ✅ |
| `npm run rotate:oidc` alias | ✅ |

### v0.44 Console self-serve + audit UI

| Dashboard: create inbox form (label + service preset) | ✅ |
| `audit.html` — paginated `GET /v1/audit` (`before` cursor) | ✅ |
| Audit API `hasMore` + `nextBefore` | ✅ |
| Sidebar + console summary `links.audit` | ✅ |

### v0.45 Distribution (catalog + review fixes)

| `run-mailagent-mcp.sh` — generic plugin-root `.env` hint | ✅ |
| `README.catalog.md` for awesome-codex-plugins paths | ✅ |
| `prepare:catalog-pr` copies catalog README into staging | ✅ |
| SKILL — console key + `test:prod` from MailAgent repo only | ✅ |
| awesome-codex-plugins PR [#195](https://github.com/hashgraph-online/awesome-codex-plugins/pull/195) refresh | ✅ pushed |

### v0.46 Enterprise — dedicated Resend

| `enterprise` plan + limits in `plans.ts` | ✅ |
| Migration `016_team_dedicated_resend` | ✅ |
| `PUT/GET/DELETE /v1/team/dedicated-resend` | ✅ |
| Encrypted team Resend key + webhook secret | ✅ |
| `POST /webhooks/resend/team/:teamId` | ✅ |
| Custom domains use team Resend when configured | ✅ |
| Enterprise requires dedicated Resend before domains | ✅ |
| `npm run team:plan -- TEAM_ID enterprise` | ✅ |
| [DEDICATED-DOMAINS.md](./DEDICATED-DOMAINS.md) | ✅ |

### v0.47 Enterprise — outbound on dedicated Resend

| `send` / `reply` use team Resend when configured | ✅ |
| From address = custom-domain inbox (`domainId` required) | ✅ |
| `capabilities.outbound.dedicatedResend` in `/v1/me` + console | ✅ |
| MCP `mailagent_send_message` passes `teamId` | ✅ |

### v0.48 Enterprise — console dedicated Resend UI

| Dashboard section: configure / status / webhook URL | ✅ |
| `dedicatedResend` in `GET /v1/console/summary` | ✅ |
| Enterprise banner before domains when not configured | ✅ |
| `contract-qa-console` checks `dedicatedResend` shape | ✅ |

### v0.49 Enterprise docs page

| `public/docs/dedicated-domains.html` | ✅ |
| Sidebar + footer nav link | ✅ |
| Cross-links from enterprise, custom-domain, dashboard | ✅ |

### v0.50 Distribution (catalog PR follow-up)

| Merge `upstream/main` into PR [#195](https://github.com/hashgraph-online/awesome-codex-plugins/pull/195) (llm-transpile + mailagent) | ✅ |
| `plugins.json` entry (106 plugins) | ✅ |
| Catalog bundle + `LICENSE` in `plugins/Alex0nder/mailagent` | ✅ |
| HOL plugin scanner CI on MailAgent `main` | ✅ [workflow](https://github.com/navorina-labs/MailAgent/actions/workflows/hol-plugin-scanner.yml) |
| `SECURITY.md` + scanner score 88/100 (0 critical/high) | ✅ |
| awesome-codex-plugins PR #195 maintainer merge | pending |

### v0.51 Enterprise — trust & compliance (public)

| `public/docs/security.html` — CC6/CC7/CC8/A1 summary | ✅ |
| Nav + `GET /v1/agent` → `security` URL | ✅ |
| `SOC2.md` — dedicated Resend tenant isolation | ✅ |
| Cross-links from enterprise + dedicated-domains | ✅ |

### v0.52 Distribution — Codex Directory prep

| `privacy.html` + `terms.html` (hosted SaaS) | ✅ |
| `plugin.json` → `privacyPolicyURL` / `termsOfServiceURL` | ✅ |
| `verify:codex` asserts publisher URLs | ✅ |
| Footer legal links · `GET /v1/agent` → `privacy`, `terms` | ✅ |
| [SKILLS-SUBMIT.md](./SKILLS-SUBMIT.md) — `gh skill publish`, Skill Hub | ✅ |
| Repo topic `agent-skills` | ✅ |
| Official Codex Plugin Directory submit | when OpenAI opens |
| awesome-codex-plugins PR #195 maintainer merge | pending |

### v0.53 Billing — Stripe prep (no account required)

| `docs/STRIPE-SETUP.md` + `public/docs/billing.html` | ✅ |
| `npm run wizard:stripe` · `setup:stripe-prod` · `doctor:billing` | ✅ |
| Webhook `subscription.updated` downgrade | ✅ |
| `test:contract:qa:billing` (503 when disabled) | ✅ |
| `canUpgradeViaStripe` (free only) | ✅ |
| Stripe live on prod (`wizard:stripe --deploy`) | operator when ready |

### v0.54 Distribution — Agent Skills release

| `gh skill publish --tag skills-0.2.5` | ✅ |
| `npm run prepare:skills-pr` staging entry | ✅ |
| awesome-agent-skills [PR #659](https://github.com/VoltAgent/awesome-agent-skills/pull/659) | submitted |
| awesome-codex-plugins PR #195 maintainer merge | pending |

### v0.55 Enterprise

| `public/docs/sla.html` draft | ✅ |
| SOC 2 Type II audit (formal) | planned |
| SLA / support tier live | with Stripe |

### v0.56 Distribution — directory readiness

| `docs/CODEX-DIRECTORY-SUBMIT.md` checklist | ✅ |
| PR #195 fork: `privacyPolicyURL` / `termsOfServiceURL` in bundle | ✅ |
| `public/docs/agent-skills.html` — gh skill pin + PR #659 | ✅ |
| awesome-codex-plugins PR #195 maintainer merge | pending |
| awesome-agent-skills PR #659 maintainer merge | pending |
| Codex official Plugin Directory submit | when OpenAI opens |

### v0.57 Distribution — Skill Hub + repo hardening

| `npm run import:skill-hub` (analyze / import) | ✅ |
| `npm run harden:repo` (secret scanning + push protection) | ✅ |
| Agent Skill Hub live listing | optional · blocked on Hub OAuth / their GitHub API |
| awesome-agent-skills PR #659 maintainer merge | pending |

### v0.58 Enterprise — SOC 2 gap docs

| `docs/OPERATOR-ACCESS.md` draft | ✅ |
| Penetration test (third party) | planned |
| SOC 2 Type II audit (formal) | planned |

### v0.59 Enterprise — pentest prep

| `docs/PENTEST-PREP.md` vendor scope | ✅ |
| `npm run doctor:security` baseline | ✅ |
| `public/docs/security.html` links | ✅ |
| Independent pentest report (third party) | planned |
| awesome-codex-plugins PR #195 · awesome-agent-skills PR #659 | pending merge |

### v0.60 CI — security baseline gate

| `.github/workflows/security-baseline.yml` | ✅ |
| PR + push `main` + weekly schedule | ✅ |
| `doctor:security` in CI (no prod secrets) | ✅ |
| Documented in `docs/CI.md` | ✅ |

### v0.61 Distribution — status board + agent discovery

| `docs/DISTRIBUTION-STATUS.md` | ✅ |
| `GET /v1/agent` → `distribution` | ✅ |
| `npm run check:catalog-prs` + weekly CI | ✅ |
| `contract-qa-agent` asserts distribution + trust URLs | ✅ |

### Distribution / enterprise — frozen until external

| awesome-codex-plugins PR #195 · awesome-agent-skills PR #659 | maintainer merge |
| Codex Plugin Directory | OpenAI self-serve |
| Stripe live · SLA tiers | operator when ready |
| Pentest report · SOC 2 Type II | third party |

### v0.62 Product — QA pilot kit

| `docs/QA-PILOT.md` 30-min guide | ✅ |
| `npm run wizard:qa-pilot` | ✅ |
| `GET /v1/agent` → `tests.qaPilot` / `qaWizard` | ✅ |
| `public/docs/qa.html` pilot section | ✅ |

### v0.63 Product — QA pilot starter (highest adoption impact)

| `examples/qa-pilot-starter/` copy-paste repo | ✅ |
| `npm run test:qa-pilot-starter` CI guard | ✅ |
| `GET /v1/agent` → `tests.qaPilotStarter` | ✅ |
| PR workflow `qa-smoke.yml` validates starter | ✅ |

### v0.64 Product — staging E2E in starter

| `signup-staging.spec.ts` (skip without `APP_SIGNUP_URL`) | ✅ |
| `mailagent.fixture.ts` auto cleanup | ✅ |
| `npm run test:staging` in starter | ✅ |

### v0.65 Product — Cypress pilot starter

| `examples/qa-pilot-cypress-starter/` | ✅ |
| `@mailagent/qa/cypress` → `mailagentSimulateAndVerify` task | ✅ |
| `npm run test:qa-pilot-cypress-starter` CI guard | ✅ |
| `GET /v1/agent` → `tests.qaPilotCypressStarter` | ✅ |

### v0.66 Publish — `@mailagent/qa@0.1.14`

| Cypress `mailagentSimulateAndVerify` task | ✅ |
| Starters on `^0.1.14` | ✅ |
| npm publish via tag `v0.39.0` | ✅ [@mailagent/qa@0.1.14](https://www.npmjs.com/package/@mailagent/qa) |

### v0.67 — adoption track complete (frozen)

| Playwright + Cypress starters + `wizard:qa-pilot` | ✅ |
| `@mailagent/qa@0.1.14` on npm | ✅ |
| All install paths documented | [DISTRIBUTION-STATUS.md](./DISTRIBUTION-STATUS.md) |
| External test repos | copy starter → secrets → `npm test` |

**Next product work:** features from pilot feedback · not blocked on MailAgent repo.

### v0.68 — agent hub package versions

| `src/lib/npm-versions.ts` | ✅ |
| `GET /v1/agent` → `packages` (pinned install strings) | ✅ |
| Starter lockfiles → `@mailagent/qa@0.1.14` | ✅ |
| `contract-qa-agent` asserts `packages` | ✅ |

### Product (baseline — done)

| v1.0 API (inbound, outbound, threads, search, MCP) | ✅ |
| QA adoption toolkit | [QA-PILOT.md](./QA-PILOT.md) |
| npm / MCP / skill install paths | ✅ |

### v0.69 — QA pilot rollout (active, Stripe on hold)

| Step | Task | Status |
|------|------|--------|
| 1 | Baseline green: `wizard:qa-pilot:onboard` (smoke + Playwright/Cypress starter guards) | ✅ last run 2026-06-14 |
| 1b | Operator kit: `issue:pilot-key`, `wizard:qa-pilot:onboard`, [PILOT-ONBOARD.md](./PILOT-ONBOARD.md) | ✅ |
| 2 | Pilot #1: identify/contact external candidate | pending · [PILOT-CANDIDATES.md](./PILOT-CANDIDATES.md) |
| 2b | Pilot #1: external test repo copies starter → CI secrets → green `npm test` | ready after candidate accepts |
| 3 | Pilot #1: staging E2E (`APP_SIGNUP_URL` + `service` preset) | pending |
| 4 | Collect feedback (setup time, flaky, missing API/docs) → [#5](https://github.com/navorina-labs/MailAgent/issues/5) / backlog v0.70 | pending |
| 5 | Pilot #2 (Cypress track or second team) | pending |
| 6 | Metrics vs targets ([QA-ROADMAP.md](./QA-ROADMAP.md): flaky <2%, setup <30 min) | pending |

Guide: [QA-PILOT.md](./QA-PILOT.md) · operators: [YOUR-TURN.md](./YOUR-TURN.md) (Stripe skipped).

### v0.70 — Context OS Phase 2 (active — parallel to pilot hold)

| Task | Status |
|------|--------|
| `npm run sync:context-os` — manifest stats, `sourceCommit`, MCP tools, presets | ✅ |
| `manifest.json` → `sourceCommit` / `syncedAt` pin | ✅ |
| Keyword router F1 on 35 Q (`routing-map.json` v1.1 + word boundaries) | ✅ **1.000** |
| Eval condition B uses live `routeQuestion` (not gold cores) | ✅ |
| Semantic router: `eval:context-os:router-build` + `route-semantic` | ✅ (keyword wins; semantic optional) |
| Product: Context OS in skill/docs | ✅ [skills/mailagent/SKILL.md](../skills/mailagent/SKILL.md) |
| `npm run check:context-os-router` (F1 gate) | ✅ |
| Eval baseline: B wins accuracy/tokens (`run-1781075014160`) | see [AI-Context-OS](https://github.com/Alex0nder/AI-Context-OS) |

### v0.71 — Product (active; Stripe on hold)

Backlog: [PRODUCT-NEXT.md](./PRODUCT-NEXT.md)

| P0 | Task | Status |
|----|------|--------|
| 1 | Console search UI (`GET …/search`) | ✅ `console-inbox.html` |
| 2 | Bulk inbox cleanup UI (`labelPrefix`) | ✅ `dashboard.html` |
| 3 | Diagnose deep-link in MCP + console | ✅ `debugUiUrl` on timeout + console banner |
| 4 | Service presets (GitLab, Bitbucket, …) | ✅ `service-presets.ts` + recipes |
| 5 | `verify_signup` subject hints per service | ✅ `SERVICE_SUBJECT_HINTS` + MCP manifest |

### v0.72 — Platform & observability (P1)

| P1 | Task | Status |
|----|------|--------|
| 6 | Team event webhook (`PUT /v1/team/webhooks`) | ✅ |
| 7 | Delivery log in console | ✅ `console-inbox.html` |
| 8 | Usage dashboard (rate-limit headroom) | ✅ dashboard + `/v1/me` |
| 9 | Public status | ✅ `GET /v1/status` + `status.html` |
| 10 | Run explorer (label filter + inbox links) | ✅ `agent-runs.html` |

### v0.73 — Differentiation (P2)

| P2 | Task | Status |
|----|------|--------|
| 11 | Simulate scenario library | ✅ `GET …/simulate/scenarios` + `scenario` param |
| 12 | Extract presets `magic_link`, `invite` | ✅ rules + MCP |
| 13 | Python SDK | ✅ `packages/mailagent-agent-py` |
| 14 | Landing use-case pages | ✅ Playwright + MCP SEO pages |
| 15 | Inbox TTL per service preset | ✅ `SERVICE_TTL_MINUTES` |

### v0.74 — Distribution (P3)

| P3 | Task | Status |
|----|------|--------|
| 16 | PyPI publish (`publish:agent-py` + CI) | ✅ |
| 17 | Landing pages in site nav / footer | ✅ |
| 18 | `@mailagent/qa` simulate `scenario` | ✅ 0.1.15 |
| 19 | Pilot starter uses monorepo QA in CI guard | ✅ |
| 20 | First external QA pilot | ⏳ baseline ✅ · key issued · feedback [#5](https://github.com/navorina-labs/MailAgent/issues/5) |
| npm `@mailagent/qa@0.1.15` | ✅ tag `v0.74.0` |
| PyPI `mailagent-agent@0.1.0` | ✅ |

### v0.75 — Pilot ops & docs

| Task | Status |
|------|--------|
| `print:pilot-invite` + PILOT-INVITE.md | ✅ |
| Team event webhook docs | ✅ `teams.html#event-webhook` |
| QA troubleshooting redirect page | ✅ |
| Issue pilot key to external team | ✅ `external-pilot` · send out-of-band only |

### v0.76 — Console & SDK visibility (P4)

| P4 | Task | Status |
|----|------|--------|
| 23 | Debug UI simulate scenario picker | ✅ `debug.html` |
| 24 | Python + QA SDK docs on agents.html | ✅ |
| 25 | PyPI in AGENTS.md / landing | ✅ |

### v0.77 — Console simulate + Python landing (P4+)

| P4+ | Task | Status |
|-----|------|--------|
| 26 | Console inbox simulate scenario picker | ✅ |
| 27 | `python-agent-verify.html` landing | ✅ |
| 28 | Issue pilot scoped key | ✅ `external-pilot` |

### v0.78 — Developer email relay (P5)

Signup form uses **temp MailAgent address**; extracted OTP / magic link **relayed to developer's real email**.

Spec: [DEV-EMAIL-RELAY.md](./DEV-EMAIL-RELAY.md)

| P5 | Task | Status |
|----|------|--------|
| 29 | Migration + `notifyEmail` / `notifyMode` on `inboxes` | ✅ `018_notify_email.sql` |
| 30 | `fireInboxNotify` after ingest (Resend, `OUTBOUND_FROM`) | ✅ |
| 31 | `GET /v1/inboxes/:id/notify-deliveries` + `notify_deliveries` table | ✅ |
| 32 | REST create/open + OpenAPI + MCP `create_inbox` | ✅ |
| 33 | Console inbox: notify address + delivery status | ✅ `notify-deliveries` UI |
| 34 | `contract-qa-notify` (simulate → delivery row) | ✅ `npm run test:contract:qa:notify` |
| 35 | `@mailagent/agent` + `@mailagent/qa` `notifyEmail` | ✅ 0.1.13 / 0.1.16 |
| 36 | Plan quota `notifyEmailsPerDay` + rate limit | ✅ `019_notify_quota_events.sql` |

**Done when:** manual QA — temp address in app, code in `dev@company.com` within ~30s.

### v0.79 — Email existence check (Reacher)

Spec: [EMAIL-CHECK.md](./EMAIL-CHECK.md) · [check-if-email-exists](https://github.com/reacherhq/check-if-email-exists)

| Task | Status |
|------|--------|
| `POST /v1/emails/check` — syntax + disposable + MX (DoH), no external deps | ✅ |
| MCP `mailagent_check_email` | ✅ |
| Disposable block on `notifyEmail` | ✅ |
| `contract-qa-email-check` | ✅ |

**Done when:** QA can call check API without sending mail or running external services.

### v0.80 — Agent flows + SDK notify

| Task | Status |
|------|--------|
| `@mailagent/agent` `createInbox` + `notifyEmail` + `listNotifyDeliveries` | ✅ 0.1.13 |
| `@mailagent/qa` `notifyEmail` + `waitForNotifyDelivery` | ✅ 0.1.16 |
| Console `notify-deliveries` UI | ✅ |
| `flow=login` / `password_reset` on verify + recipes | ✅ |
| Simulate `login_2fa`, `password_reset` scenarios | ✅ |
| Skill: callbackUrl + notifyEmail + flows | ✅ |

### v0.81 — Agent-native reliability

Spec: [AGENT-PBR.md](./AGENT-PBR.md)

| Task | Status |
|------|--------|
| Failure recovery hints in `GET …/diagnose` and `mailagent_diagnose_inbox` | ✅ |
| Verification confidence + alternatives | ✅ |
| Flow templates in `GET /v1/agent` | ✅ |
| Run timeline by `runId` | ✅ |
| Auto-cleanup policies | ✅ |
| Agent-safe HTML action extraction | ✅ |

### v0.84 — Workspace autonomy policies

| Task | Status |
|------|--------|
| Admin policy: `draft_only`, `auto_send_safe`, `full_auto` | ✅ |
| Recipient-domain, confidence, and hourly send guardrails | ✅ |
| Idempotent `POST /v1/workspace/execute-reply` | ✅ |
| MCP policy + execute tools | ✅ |
| Planner selects guarded execution for stored mail context | ✅ |
| Action/audit log and reminder completion after send | ✅ |
| Public LLM provider metadata cannot expose API keys | ✅ |
| DeepSeek/Qwen fallback + readiness/probe API | ✅ |

Guide: [WORKSPACE-AUTONOMY.md](./WORKSPACE-AUTONOMY.md).

### Deferred (not QA)

- ~~Agent session memory / multi-step run state~~ ✅ v0.35
- ~~OIDC on prod~~ ✅ v0.40
- **Stripe on prod** — **on hold** · prep ✅ · `wizard:stripe --deploy` when ready
- ~~`OUTBOUND_FROM` on prod~~ ✅
- ~~Codex repo marketplace~~ ✅ `.agents/plugins/marketplace.json`
- Codex official Plugin Directory submit — coming soon (OpenAI)

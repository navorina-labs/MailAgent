# Your turn — manual prod setup (no Stripe)

What **only a human** can enable. Everything else runs without you.

**Stripe is on hold** — skip `STRIPE_*` until the tax number is ready and the Stripe account can be registered.

## Works without you (agents can use prod today)

| Path | Command / URL |
|------|----------------|
| MCP + REST verify | `MAILAGENT_API_KEY` in CI · `npm run smoke:agent` |
| Agent skill from GitHub | `npx skills add navorina-labs/MailAgent --skill mailagent` |
| Pinned skill release | `gh skill install navorina-labs/MailAgent mailagent --pin skills-0.2.5` |
| Codex plugin (repo marketplace) | `codex plugin marketplace add navorina-labs/MailAgent` → `codex plugin add mailagent@mailagent` |
| npm packages | `@mailagent/mcp` · `@mailagent/agent` · `@mailagent/qa` |
| Docs / privacy / terms / SLA draft | hosted on webmailagent.com |

**Catalog PRs** ([#195](https://github.com/hashgraph-online/awesome-codex-plugins/pull/195), [#659](https://github.com/VoltAgent/awesome-agent-skills/pull/659)) — submitted; merge is maintainer-only, not blocking install. Current check: #195 mergeable, #659 clean after fork refresh. Status: `npm run check:catalog-prs` · [DISTRIBUTION-STATUS.md](./DISTRIBUTION-STATUS.md).

## Blocked without a human (optional visibility)

| Item | Why agents can't do it |
|------|------------------------|
| Agent Skill Hub listing | Hub API needs `skhub login` / browser OAuth or their GitHub token is down |
| Codex Plugin Directory | OpenAI self-serve not open yet |
| Stripe live | Waiting for tax number / Stripe account, then `wizard:stripe --deploy` |
| SOC 2 Type II | Paid audit + legal sign-off |
| awesome-* PR merge | External repo maintainers |

Run anytime:

```bash
export MAILAGENT_API_KEY="$(grep '^MAILAGENT_API_KEY=' .env | cut -d= -f2- | tr -d '"')"
npm run doctor:operator
```

---

## Already automated (nothing to do)

| Item | Status |
|------|--------|
| Deploy on push `main` | GitHub Actions |
| Prod gate `test:prod:gate` on deploy; full `test:prod` on tag `v*` |
| OIDC browser login (Auth0) | ✅ enabled on prod |
| npm publish on tag `v*` | Trusted Publishing |
| MCP OAuth `mat_` JWT | no KV quota needed |
| Agent run session | verify + MCP + `GET /runs/:id` |
| Agent Skills (`skills/mailagent/`) | `npx skills add` · `npm run sync:skills` |

---

## 1. GitHub Secrets

Repo → **Settings → Secrets and variables → Actions**

| Secret | Required | Notes |
|--------|----------|--------|
| `CLOUDFLARE_API_TOKEN` | yes | Worker deploy |
| `CLOUDFLARE_ACCOUNT_ID` | yes | from `wrangler.jsonc` |
| `MAILAGENT_API_KEY` | yes | same key as local `.env` |
| `DATABASE_URL` | optional | auto `db:migrate` on deploy; copy to `.env` for `issue:pilot-key` |
| `PYPI_API_TOKEN` | optional | `mailagent-agent` on tag `v*` — re-run publish workflow after add |

Verify: last [Deploy Worker](https://github.com/navorina-labs/MailAgent/actions/workflows/deploy-worker.yml) run is green.

**QA pilot #1:** baseline green (`wizard:qa-pilot:onboard`). First pick/contact a candidate: [PILOT-CANDIDATES.md](./PILOT-CANDIDATES.md). After they accept, send invite: `npm run print:pilot-invite -- <slug>`. Issue/send key locally and privately: [PILOT-ONBOARD.md](./PILOT-ONBOARD.md).

---

## 2. Outbound (send / reply) ✅ prod

`OUTBOUND_FROM=MailAgent <noreply@webmailagent.com>` on Worker.

Check:

```bash
curl -sS https://api.webmailagent.com/v1/me \
  -H "Authorization: Bearer $MAILAGENT_API_KEY" | jq .capabilities.outbound
# verifiedFrom: true
```

Contract: `npm run test:contract:qa:outbound` (uses prod API)

Details: [outbound.html](https://webmailagent.com/docs/outbound.html)

---

## 3. OIDC (browser login for MCP) ✅

Auth0 tenant `webmailagent.us.auth0.com` · app **MailAgent MCP** · `auth.oidc: enabled`.

Rotate Client Secret if it was shared in chat → update `.dev.vars` → `npm run rotate:oidc`.

Guide: [MCP-OAUTH-IDP.md](./MCP-OAUTH-IDP.md)

---

## 4. Resend domain quota

If `contract-qa-domains` skips with **domain quota exhausted**:

1. Resend dashboard → delete stale test domains
2. Or upgrade Resend plan

Local check (uses `RESEND_API_KEY` from `.dev.vars`):

```bash
npm run doctor:operator
```

---

## 5. Codex Marketplace

**Repo marketplace (works today):**

```bash
codex plugin marketplace add navorina-labs/MailAgent
codex plugin add mailagent@mailagent
```

Set `MAILAGENT_API_KEY` when prompted. Verify: `codex mcp list` → server `mailagent`.

**Tarball (manual share):**

```bash
npm run package:codex
# → dist/mailagent-codex-plugin-0.2.5.tar.gz
```

**Official Plugin Directory:** self-serve publish coming soon — [CODEX-DIRECTORY-SUBMIT.md](./CODEX-DIRECTORY-SUBMIT.md).

Third-party catalogs: [CATALOG-SUBMIT.md](./CATALOG-SUBMIT.md) — PR [#195](https://github.com/hashgraph-online/awesome-codex-plugins/pull/195) mergeable.

**Agent Skills catalog:** PR [#659](https://github.com/VoltAgent/awesome-agent-skills/pull/659) submitted.

---

## 6. Optional — Agent Skill Hub (visibility only)

**Not required for install** — skill ships from this repo. Hub import only adds search on [agentskillhub.dev](https://agentskillhub.dev); needs your browser login (`skhub login`) because the public analyze API returns GitHub 401.

```bash
gh skill publish --dry-run
skhub login && export SKILLHUB_TOKEN=… && npm run import:skill-hub
```

Skip until you care about Hub SEO. Guide: [SKILLS-SUBMIT.md](./SKILLS-SUBMIT.md)

---

## 7. Stripe Pro (when you have an account)

Код и UI уже готовы — секреты не ставим, пока не нужен биллинг.

```bash
npm run wizard:stripe              # чеклист Dashboard + .dev.vars
npm run wizard:stripe -- --deploy  # wrangler secret put на prod
npm run doctor:billing
```

Guide: [STRIPE-SETUP.md](./STRIPE-SETUP.md) · [billing.html](https://webmailagent.com/docs/billing.html)

---

## On hold

| Item | Why wait |
|------|----------|
| **Stripe live keys on prod** | until you run `wizard:stripe --deploy` |
| Workers Paid ($5/mo) | only if KV 1000 puts/day is hit again |

---

## Quick verify after any change

```bash
npm run doctor:operator
npm run test:prod
```

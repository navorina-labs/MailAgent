# Distribution status

Single source of truth for catalogs and install paths. **Install works today** — merge PRs are visibility only.

Last automated check: CI `check:catalog-prs` (weekly) · discovery: `GET /v1/agent` → `distribution`

## Adoption (QA pilots)

| Asset | Path |
|-------|------|
| Playwright starter | [examples/qa-pilot-starter](../examples/qa-pilot-starter) |
| Cypress starter | [examples/qa-pilot-cypress-starter](../examples/qa-pilot-cypress-starter) |
| 30-min guide | [QA-PILOT.md](./QA-PILOT.md) |
| Validate key | `npm run wizard:qa-pilot:onboard` |
| npm QA SDK | `@mailagent/qa@0.1.17` (`mailagentSimulateAndVerify` + notify + CI failure artifact helpers) |

## Install (live)

| Channel | Command |
|---------|---------|
| Agent skill | `npx skills add navorina-labs/MailAgent --skill mailagent` |
| Pinned release | `gh skill install navorina-labs/MailAgent mailagent --pin skills-0.2.5` |
| Codex marketplace | `codex plugin marketplace add navorina-labs/MailAgent` → `codex plugin add mailagent@mailagent` |
| MCP npm | `npx -y -p @mailagent/mcp@latest mailagent-mcp` |
| REST SDK | `npm i @mailagent/agent @mailagent/qa` |

## Curated catalogs (pending maintainer merge)

| Catalog | PR | State |
|---------|-----|--------|
| [awesome-codex-plugins](https://github.com/hashgraph-online/awesome-codex-plugins) | [#195](https://github.com/hashgraph-online/awesome-codex-plugins/pull/195) | open, mergeable |
| [awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills) | [#659](https://github.com/VoltAgent/awesome-agent-skills/pull/659) | open, clean after fork refresh |

```bash
npm run check:catalog-prs
```

## Blocked on external parties

| Item | Blocker | Prep doc |
|------|---------|----------|
| Codex Plugin Directory | OpenAI self-serve; tarball ready: `dist/mailagent-codex-plugin-0.2.5.tar.gz` | [CODEX-DIRECTORY-SUBMIT.md](./CODEX-DIRECTORY-SUBMIT.md) |
| Agent Skill Hub search | Hub OAuth / `skhub login`; `gh skill publish --dry-run` passes | [SKILLS-SUBMIT.md](./SKILLS-SUBMIT.md) |
| Stripe Pro + SLA live | Stripe account | [STRIPE-SETUP.md](./STRIPE-SETUP.md) |
| Pentest report | Third-party vendor | [PENTEST-PREP.md](./PENTEST-PREP.md) |
| SOC 2 Type II | Formal audit | [SOC2.md](./SOC2.md) |

## Operator-only (optional)

See [YOUR-TURN.md](./YOUR-TURN.md) — Skill Hub import, Stripe deploy. Not required for agents.

## Repo automation

| Workflow | Purpose |
|----------|---------|
| [security-baseline.yml](../.github/workflows/security-baseline.yml) | `doctor:security` |
| [hol-plugin-scanner.yml](../.github/workflows/hol-plugin-scanner.yml) | Codex catalog score |
| [deploy-worker.yml](../.github/workflows/deploy-worker.yml) | prod deploy + `test:prod:gate` |

Roadmap freeze: [ROADMAP.md](./ROADMAP.md) v0.60+.

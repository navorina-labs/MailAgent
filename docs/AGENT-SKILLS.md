# Agent Skills ecosystem

MailAgent ships a canonical [Agent Skills](https://agentskills.io/) skill so Cursor, Codex, Claude Code, Copilot, and `npx skills add` users get the same signup/OTP guidance.

Inspired by curated catalogs like [membranedev/application-skills](https://github.com/membranedev/application-skills) — MailAgent covers **verification email**, not general SaaS integrations.

## Install

```bash
# Agent Skills CLI (repo-root skill)
npx skills add navorina-labs/MailAgent --skill mailagent

# Cursor — skill syncs to .cursor/skills/mailagent-mcp/ on npm run sync:skills
# Codex — codex plugin marketplace add navorina-labs/MailAgent && codex plugin add mailagent@mailagent
```

Canonical source: [`skills/mailagent/SKILL.md`](../skills/mailagent/SKILL.md)

After editing the canonical skill:

```bash
npm run sync:skills
npm run verify:skills
```

## MailAgent vs integration skills

| Layer | Example | Role |
|-------|---------|------|
| **MailAgent** | `mailagent_verify_signup` | Disposable inbox, OTP, magic link during signup |
| **Membrane / app skills** | `github`, `slack`, `hubspot` | Authenticated actions after login |
| **Gmail skill** | list/send real user mail | Not a MailAgent substitute |

Typical agent pipeline:

```
1. mailagent_issue_access when a team admin key should mint a short-lived scoped run key
2. mailagent_start_run before browser work to create resumable state
3. mailagent_report_run after each form submit, wait, timeout, or failure
4. mailagent_next_run when the agent needs the next tool + payload from saved state
5. mailagent_suggest_preset when sender/service is unclear
6. mailagent_create_inbox (service: github, or expectFrom for custom sender)
7. Browser: submit address on github.com/signup
8. mailagent_verify_signup → primaryAction (OTP or link)
9. Complete signup
10. Membrane github skill → create issue, open PR, etc.
```

## Service recipes + post-signup

Presets align with common integration targets:

```bash
curl -sS -H "Authorization: Bearer $MAILAGENT_API_KEY" \
  https://api.webmailagent.com/v1/agent/recipes/github | jq .
```

Unknown sender or auth provider:

```bash
curl -sS -X POST -H "Authorization: Bearer $MAILAGENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"from":"Auth0 <no-reply@auth0.com>","subject":"Verify your email"}' \
  https://api.webmailagent.com/v1/agent/preset-advice | jq .
```

After verify, point the agent at the product API or a Membrane skill for the same service name (`github`, `stripe`, `auth0`, …).

## Distribution channels

| Channel | Status |
|---------|--------|
| Repo skill `skills/mailagent/` | ✅ |
| Cursor `.cursor/skills/mailagent-mcp/` | ✅ synced |
| Codex plugin + marketplace | ✅ [CODEX.md](./CODEX.md) |
| `npx skills add` | ✅ document in skill + this page |
| Official Codex Plugin Directory | coming soon (OpenAI) |
| Third-party catalogs (awesome-*) | optional PR to list MailAgent |
| OIDC contract when enabled | `test:contract:qa:oidc` (skip if disabled) |

## Maintainer checklist

1. Edit `skills/mailagent/SKILL.md` only (single source of truth)
2. `npm run sync:skills`
3. `npm run verify:skills` (runs in `verify:codex` / `package:codex`)
4. Bump `metadata.version` in frontmatter when MCP package changes

Catalog submission: [SKILLS-SUBMIT.md](./SKILLS-SUBMIT.md) · Codex plugin: [CATALOG-SUBMIT.md](./CATALOG-SUBMIT.md) · [AGENTS.md](../AGENTS.md) · [AUTOTESTS.md](./AUTOTESTS.md)

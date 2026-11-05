# Submit MailAgent to curated Codex catalogs

MailAgent is already installable via **repo marketplace** (`.agents/plugins/marketplace.json`).  
This doc is for **third-party curated lists** like [awesome-codex-plugins](https://github.com/hashgraph-online/awesome-codex-plugins).

## Our install paths (live today)

| Channel | Command |
|---------|---------|
| GitHub marketplace | `codex plugin marketplace add navorina-labs/MailAgent` |
| Agent Skills | `npx skills add navorina-labs/MailAgent --skill mailagent` |
| npm MCP | `npx -y -p @mailagent/mcp@0.2.16 mailagent-mcp` |

Docs: https://webmailagent.com/docs/codex.html · https://webmailagent.com/docs/agents.html

## awesome-codex-plugins (optional PR)

That repo mirrors plugin bundles under `plugins/` and lists them in `.agents/plugins/marketplace.json`.  
Upstream expects a **fork + PR**, not a raw tarball URL.

### Steps

```bash
npm run prepare:catalog-pr
# → dist/catalog-staging/plugins/Alex0nder/mailagent  (includes assets/icon.svg + composerIcon)
# → dist/catalog-staging/MARKETPLACE-ENTRY.json
# → dist/catalog-staging/PLUGINS-ENTRY.json
```

Then fork + PR to [awesome-codex-plugins](https://github.com/hashgraph-online/awesome-codex-plugins):

1. Fork https://github.com/hashgraph-online/awesome-codex-plugins
2. Copy `dist/catalog-staging/plugins/Alex0nder/mailagent` → `plugins/Alex0nder/mailagent`
3. Merge `MARKETPLACE-ENTRY.json` into `.agents/plugins/marketplace.json` (add `icon` if present)
4. Add `README-ENTRY.md` line under **Development & Workflow** (alphabetical)
5. Run `python3 scripts/generate_plugins_json.py` in the fork and commit `plugins.json` sync
6. Open PR — title: `Add MailAgent plugin (email verification for agents)`

**Status:** [PR #195](https://github.com/hashgraph-online/awesome-codex-plugins/pull/195) — conflicts resolved, mergeable; HOL scanner CI on MailAgent `main` (score 88/100).

Marketplace entry shape (for reference):

```json
{
  "name": "mailagent",
  "displayName": "MailAgent",
  "source": { "source": "local", "path": "./plugins/Alex0nder/mailagent" },
  "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
  "category": "Development & Workflow",
  "description": "Temporary inboxes for Codex — OTP, magic links, signup QA, simulate-first autotests (40 MCP tools)."
}
```

### PR body template

```markdown
## MailAgent

Disposable inboxes for agent signup flows — OTP and magic link extraction via MCP.

- Repo: https://github.com/navorina-labs/MailAgent
- Docs: https://webmailagent.com/docs/codex.html
- MCP tools: 40 (suggest_preset, verify_signup, Workspace Agent, simulate, diagnose, threads, domains, …)
- MIT license

Install after merge:
`codex plugin marketplace add hashgraph-online/awesome-codex-plugins`
→ browse **mailagent**
```

## Agent Skills aggregators

For [Agent Skills](https://agentskills.io/) catalogs, point maintainers at:

- Canonical skill: `skills/mailagent/SKILL.md`
- Install: `npx skills add navorina-labs/MailAgent --skill mailagent`
- Guide: [AGENT-SKILLS.md](./AGENT-SKILLS.md)

## Official OpenAI Plugin Directory

Self-serve publish is **coming soon** (OpenAI). Full checklist: [CODEX-DIRECTORY-SUBMIT.md](./CODEX-DIRECTORY-SUBMIT.md).

Required URLs (already live in `plugin.json` and synced to PR #195):

- Privacy: https://webmailagent.com/privacy.html
- Terms: https://webmailagent.com/terms.html

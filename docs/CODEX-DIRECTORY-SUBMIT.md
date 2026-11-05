# Submit MailAgent to the official Codex Plugin Directory

OpenAI self-serve publish is **coming soon**. This checklist is ready when the dashboard opens — no code changes required beyond keeping `plugin.json` URLs current.

## Prerequisites (done)

| Item | Status |
|------|--------|
| Privacy policy | https://webmailagent.com/privacy.html |
| Terms of service | https://webmailagent.com/terms.html |
| `interface.privacyPolicyURL` / `termsOfServiceURL` in plugin.json | ✅ `examples/codex/plugin/.codex-plugin/plugin.json` |
| `verify:codex` asserts publisher URLs | ✅ |
| Tarball packaging | ✅ `npm run package:codex` → `dist/mailagent-codex-plugin-0.2.5.tar.gz` |
| Curated catalog PR | [awesome-codex-plugins #195](https://github.com/hashgraph-online/awesome-codex-plugins/pull/195) (parallel track) |
| Repo marketplace install | ✅ `codex plugin marketplace add navorina-labs/MailAgent` → `codex plugin add mailagent@mailagent` |

## When the directory opens

1. **Validate locally**

   ```bash
   npm run verify:codex
   npm run package:codex
   ```

2. **Upload** `dist/mailagent-codex-plugin-<version>.tar.gz` in the Codex Plugin Directory UI (or follow the flow in [Build plugins](https://developers.openai.com/codex/plugins/build)).

3. **Confirm metadata** matches `plugin.json`:
   - displayName: MailAgent
   - category: Productivity
   - capabilities: MCP, Skills
   - homepage: https://webmailagent.com/docs/agents.html

4. **Smoke after listing**

   ```bash
   codex mcp add mailagent -- npx -y -p @mailagent/mcp@latest mailagent-mcp
   npm run smoke:agent
   ```

## Keep in sync

After each MailAgent release that bumps the Codex plugin version:

```bash
npm run prepare:catalog-pr
# Sync plugin bundle to awesome-codex-plugins fork if PR #195 still open:
rsync -a dist/catalog-staging/plugins/Alex0nder/mailagent/ \
  /path/to/awesome-codex-plugins/plugins/Alex0nder/mailagent/
```

See also [CATALOG-SUBMIT.md](./CATALOG-SUBMIT.md) · [CODEX.md](./CODEX.md).

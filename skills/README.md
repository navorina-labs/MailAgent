# MailAgent Agent Skills

Canonical skill for the [Agent Skills](https://agentskills.io/) ecosystem (Cursor, Codex, Claude Code, Copilot, `npx skills add`, …).

| Skill | Path | Install |
|-------|------|---------|
| **mailagent** | [mailagent/SKILL.md](./mailagent/SKILL.md) | `npx skills add navorina-labs/MailAgent --skill mailagent` |

## Sync to client paths

After editing `skills/mailagent/SKILL.md`:

```bash
npm run sync:skills
```

Copies to:

- `.cursor/skills/mailagent-mcp/SKILL.md` (Cursor project skill)
- `examples/codex/plugin/skills/mailagent/SKILL.md` (Codex plugin bundle)

Verify: `npm run verify:skills` (included in `verify:codex` / `package:codex`).

## Related

- [docs/AGENT-SKILLS.md](../docs/AGENT-SKILLS.md) — ecosystem + combo flows
- [docs/CODEX.md](../docs/CODEX.md) — Codex plugin marketplace
- [AGENTS.md](../AGENTS.md) — agent autonomy / test:prod

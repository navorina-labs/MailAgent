# Codex token budget guide

MailAgent has large docs, generated Context OS artifacts, public HTML/CSS, and many contract scripts. Future agents should optimize for narrow context before broad exploration.

## Default workflow

1. Classify the task.
2. Read `AGENTS.md` plus the smallest matching Context OS core.
3. Open only files named by that core or by the user.
4. Run the smallest relevant check.
5. Summarize command results instead of pasting long output.

## Cheap commands

```bash
git status --short
git diff --name-only
rg --files src/routes src/services docs | head -80
rg -n "pattern" src/routes/workspace.ts src/services/workspace-agent.ts
sed -n '120,220p' src/routes/workspace.ts
npm run check
```

## Expensive commands

Avoid these unless the task truly needs them:

```bash
rg -n "pattern" .
git diff
npm run
npm run test:prod
npm run test:contract:all
sed -n '1,2200p' public/styles.css
cat context-os/manifest.json
```

If a broad command is unavoidable, constrain output with a path, `head`, or a short match list.

## Test selection

Use the routing table in `AGENTS.md` before running tests. Examples:

| Change | First check |
|--------|-------------|
| TypeScript route/service | `npm run check` |
| MCP manifest or presets | `npm run sync:context-os && npm run check:context-os-router` |
| Inbox/simulate/extract | `npm run test:contract:qa` |
| Email check | `npm run test:contract:qa:email-check` |
| Security/docs policy | `npm run doctor:security` |

Run `npm run test:prod` only before merge/release or when explicitly requested.

## Output discipline

- Prefer `git diff -- file` over full `git diff`.
- Prefer `sed -n` windows over whole-file reads.
- Prefer `rg --files` for navigation.
- Do not load `context-os/eval/results/`, large generated assets, or full public CSS unless editing that exact surface.
- When a command returns more than needed, rerun a narrower command instead of analyzing the whole output.

## Long conversations

For a new unrelated task, start a new thread. Long threads make every turn more expensive because prior messages, tool outputs, and screenshots remain in context.

# @mailagent/mcp

MCP server (stdio) for Cursor and other MCP clients.

## Cursor: recommendations

| What | Recommendation |
|-----|----------------|
| Protocol | [MCP](https://modelcontextprotocol.io) — open standard, Cursor = **client** |
| SDK | `@modelcontextprotocol/sdk` + `zod` |
| Transport for local dev | **stdio** (Cursor spawns the process) |
| Config | `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global) |
| Secrets | `env` / `envFile` in mcp.json, not in chat |
| Logs | **stderr** only |

Cursor docs: [Model Context Protocol](https://docs.cursor.com/context/model-context-protocol) (Settings → MCP → Add server).

There is no separate «Cursor SDK for MCP» — you write a normal MCP server; Cursor connects it as a subprocess.

## Build

```bash
npm install
npm run build
```

## Variables

- `MAILAGENT_API_URL` — Worker base URL (default `http://127.0.0.1:8787`)
- `MAILAGENT_API_KEY` — Bearer token (= Worker `API_KEY`)

## Local run (debug)

```bash
MAILAGENT_API_URL=http://127.0.0.1:8787 MAILAGENT_API_KEY=xxx node dist/index.js
```

Process waits for JSON-RPC on stdin; for testing use Cursor MCP logs.

## OpenAI Codex

Codex reads MCP from `~/.codex/config.toml` or **plugin** (bundled `.mcp.json`).

| Method | File |
|--------|------|
| config.toml (stdio / remote HTTP) | [examples/codex/config.toml.example](../examples/codex/config.toml.example) |
| Local plugin | [examples/codex/plugin/](../examples/codex/plugin/) |
| Full plan | [docs/CODEX.md](../docs/CODEX.md) |

```bash
codex mcp add mailagent -- npx -y -p @mailagent/mcp@0.2.2 mailagent-mcp
export MAILAGENT_API_KEY=...
export MAILAGENT_API_URL=https://mail-api.navorina.ai
```

Remote (no subprocess): `url = "https://mail-api.navorina.ai/mcp"` + `Authorization: Bearer …`.

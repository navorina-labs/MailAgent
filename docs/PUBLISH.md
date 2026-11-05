# Publishing @mailagent/* to npm

## Packages

| Package | Version | Purpose |
|-------|--------|------------|
| `@mailagent/mcp` | see `mcp/package.json` | stdio MCP for Cursor |
| `@mailagent/qa` | see `packages/mailagent-qa/package.json` | Playwright / Cypress QA SDK |
| `@mailagent/agent` | see `packages/mailagent-agent/package.json` | REST + remote MCP SDK |
| `mailagent-agent` (PyPI) | see `packages/mailagent-agent-py/pyproject.toml` | Python verify SDK |

Build check:

```bash
npm run publish:check
```

## Before first publish (required)

### 1. `@mailagent` organization

Scope `@mailagent` on npm **is not created yet** (or you lack permissions).

1. [npmjs.com/org/create](https://www.npmjs.com/org/create)
2. Org name: **`mailagent`** (yields `@mailagent/mcp`, …)
3. Free plan is enough for public packages

### 2. Two-factor authentication (2FA)

npm **will not publish** without 2FA. Error:

```
403 … Two-factor authentication or granular access token with bypass 2fa enabled is required
```

1. [npmjs.com/settings](https://www.npmjs.com/settings) → **Two-Factor Authentication**
2. Mode: **Authorization and publishing** (not login only)
3. Re-login:

```bash
npm logout
npm login
```

On `npm publish`, CLI will ask for **OTP** from your app (Google Authenticator, etc.).

### 3. Publish

```bash
npm run publish:all
```

Or one at a time:

```bash
npm run publish:mcp
npm run publish:qa
npm run publish:agent
```

## GitHub Actions (OIDC Trusted Publishing)

No `NPM_TOKEN` and no OTP on every release:

1. npm → each package → **Settings → Trusted Publisher**
2. GitHub Actions · org `navorina-labs` · repo `MailAgent` · workflow `publish-packages.yml`
3. Permissions: `npm publish`, `npm stage publish`
4. Push tag:

```bash
git tag v0.27.0 && git push origin v0.27.0
```

Workflow: `.github/workflows/publish-packages.yml` (`id-token: write`, `npm publish --provenance`).

### Manual publish (fallback)

```bash
npm run publish:all
```

Requires 2FA/passkey OTP or granular token with bypass 2FA.

## Python (PyPI)

Package: **`mailagent-agent`** in `packages/mailagent-agent-py/`.

1. [pypi.org/manage/account/token](https://pypi.org/manage/account/token/) — scope **Entire account** (or project-scoped after first upload)
2. Local:

```bash
PYPI_API_TOKEN=pypi-… npm run publish:agent-py
```

3. CI: GitHub secret **`PYPI_API_TOKEN`** — optional step in `publish-packages.yml` (skipped when secret unset)

Verify:

```bash
pip index versions mailagent-agent
```

## Common errors

| Error | Fix |
|--------|---------|
| `403 … Two-factor authentication` | Enable 2FA + `npm logout` / `npm login`, enter OTP on publish |
| `403 … you do not have access` | Create org `@mailagent`, you must be owner |
| `402 … must pay` | Scope taken — different org name or contact scope owner |
| Version already exists | Bump `version` in `package.json` and retry |

## After publish

Verify:

```bash
npm view @mailagent/mcp version
npm view @mailagent/qa version
npm view @mailagent/agent version
```

Update README / docs if major/minor changed.

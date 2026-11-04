# MailAgent QA pilot — Cypress starter

**Cypress + `@mailagent/qa/cypress`** — simulate OTP without staging mail.

## Quick start

```bash
cp .env.example .env   # MAILAGENT_API_KEY
export $(grep -v '^#' .env | xargs)
npm install
npm test
```

## Staging E2E

```bash
# .env — base URL + signup path
CYPRESS_BASE_URL=https://your-staging.app
APP_SIGNUP_URL=/signup
npm run test:staging
```

`signup-staging.cy.ts` is skipped in default `npm test`.

## Playwright starter

Prefer Playwright? Use [qa-pilot-starter](../qa-pilot-starter).

## Docs

- [QA-PILOT.md](../../docs/QA-PILOT.md)
- [agents.navorina.ai/docs/qa.html](https://agents.navorina.ai/docs/qa.html)

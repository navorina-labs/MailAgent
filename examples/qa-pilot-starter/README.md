# MailAgent QA pilot starter

Minimal **Playwright + `@mailagent/qa`** project — simulate OTP without staging mail or Resend.

## Quick start

```bash
cp .env.example .env   # set MAILAGENT_API_KEY
npm install
npm test               # simulate OTP + magic_link scenario (no staging mail)
```

From MailAgent repo root (operators):

```bash
npm run wizard:qa-pilot
```

## Use in your test repo

1. Copy this folder into your repo (or fork).
2. GitHub → Settings → Secrets → `MAILAGENT_API_KEY`.
3. Push — `.github/workflows/mailagent.yml` runs on PR.

## Real signup E2E (phase 2)

1. Set `APP_SIGNUP_URL` in `.env` (staging signup page).
2. Match `service` in `mailagent.fixture.ts` to your sender (`auth0`, `github`, …).
3. Run:

```bash
npm run test:staging
```

`tests/signup-staging.spec.ts` is **skipped** in default `npm test` / CI until `APP_SIGNUP_URL` is set.

## Docs

- [QA-PILOT.md](../../docs/QA-PILOT.md)
- [agents.navorina.ai/docs/qa.html](https://agents.navorina.ai/docs/qa.html)

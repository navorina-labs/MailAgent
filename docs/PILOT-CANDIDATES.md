# QA Pilot Candidates

Working list for finding Pilot #1 while Stripe is on hold. Do not store `ma_...` keys here. Send keys only after a candidate accepts the pilot and has a private channel for secrets.

## Candidate Tracker

| Candidate | Contact | Stack | Signup flow | Status | Next action | Notes |
|-----------|---------|-------|-------------|--------|-------------|-------|
| TBD | TBD | Playwright/Cypress/other | signup / login / password reset | identified | ask if they want a 30 min QA pilot | Good fit if they have email verification in CI. |

Statuses:

| Status | Meaning |
|--------|---------|
| `identified` | Possible team/person, no message sent yet |
| `contacted` | First no-key outreach sent |
| `accepted` | They agreed to try it |
| `key_sent` | Scoped `MAILAGENT_API_KEY` sent privately |
| `ci_green` | Starter copied and `npm test` passed |
| `staging_green` | `APP_SIGNUP_URL` flow passed |
| `feedback_done` | Feedback captured in issue #5 |
| `declined` | Not a fit now |

## Good Candidate Profile

- Uses Playwright or Cypress in CI.
- Has signup, login, invite, or password-reset email verification.
- Can add one GitHub Actions secret.
- Has a staging signup URL, or at least wants to start with simulated email.
- Feels pain from shared test inboxes, flaky OTP waits, or manual email checks.

Avoid for Pilot #1:

- Teams that require procurement, security review, or billing before a simple trial.
- Teams with no automated browser tests.
- Teams that cannot use external API keys in CI.

## First Message (No Key)

```text
Hey — I’m looking for one QA/dev team to try MailAgent for email verification in CI.

It replaces shared test inboxes with disposable inboxes per test run and works with Playwright/Cypress. Setup is meant to be ~30 minutes: copy a starter, add one CI secret, run npm test. The first test can use simulated email, then we can wire your staging signup URL.

Would you be open to trying it and telling me where the setup breaks or feels unclear?
```

## Acceptance Reply

```text
Great. I’ll send two things:

1. Setup instructions:
   https://github.com/navorina-labs/MailAgent/tree/main/examples/qa-pilot-starter

2. A scoped MAILAGENT_API_KEY separately through a private channel.

Start with:
  git clone https://github.com/navorina-labs/MailAgent.git /tmp/mailagent
  cp -R /tmp/mailagent/examples/qa-pilot-starter ./mailagent-qa
  cd mailagent-qa
  cp .env.example .env
  npm install && npm test

After simulate is green, send me:
- setup time
- test stack
- any error/confusing step
- staging signup URL/service preset if you want to try real E2E
```

## Key Rules

- Never send `MAILAGENT_API_KEY` in a public issue, PR, screenshot, or CI log.
- Issue or reuse a scoped key only after acceptance.
- Prefer scoped keys with `labelPrefix=ci-`.
- Send the key separately from the invite text, via 1Password, encrypted DM, or another private channel.
- Record only status and feedback in [issue #5](https://github.com/navorina-labs/MailAgent/issues/5).

## Feedback Questions

Ask after `npm test` or staging E2E:

| Question | Target |
|----------|--------|
| Minutes from first message to green `npm test`? | < 30 |
| What was unclear? | docs / package install / CI secret / service preset |
| Did email wait flake? | < 2% |
| What sender/service do they use? | add preset if missing |
| Would they keep this in CI? | yes/no + why |

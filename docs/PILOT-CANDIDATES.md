# QA Pilot Candidates

Working list for the first pilots. Keys are self-serve now: candidates get a Free key at https://webmailagent.com/get-key. Never store `ma_...` keys here.

Goal from the business plan: 8 to 10 contacts a week, 5 active pilots by February 2027.

## How the list was built

Public repos whose e2e tests already read email: Mailosaur, MailSlurp, Mailpit, MailSlurper or Inbucket in `e2e/` or `cypress/` (GitHub code search, 10 November 2026). These teams already feel the problem and already pay for it in money (Mailosaur, MailSlurp) or in setup (a local SMTP container).

Contact through the project's own channel: Discord or Slack from the README, a GitHub Discussion, or the maintainer listed in the repo. Do not open issues that read like ads.

## Candidate Tracker

| Candidate | Evidence in repo | Stack | Flows | Status | Angle |
|-----------|------------------|-------|-------|--------|-------|
| [BuilderIO/agent-native](https://github.com/BuilderIO/agent-native) | Mailosaur in `e2e/` | Playwright | auth | identified | Agent framework testing with a paid inbox service. MCP and `agent.primaryAction` fit their own story |
| [HarperFast/studio](https://github.com/HarperFast/studio) | `e2e/tests/mail.ts`, Mailosaur and MailSlurp | Playwright | sign-in, verify | identified | Two mail services in one suite. One API, Free plan |
| [nomadkaraoke/karaoke-gen](https://github.com/nomadkaraoke/karaoke-gen) | `frontend/e2e/helpers/email-testing.ts`, Mailosaur | Playwright | auth | identified | Small team paying Mailosaur. Free plan covers them |
| [teamhanko/hanko](https://github.com/teamhanko/hanko) | `e2e/helper/MailSlurper.ts`, passcode login | Playwright | login passcode | identified | Auth vendor. Hosted inbox per run instead of a local SMTP container in CI |
| [DefGuard/defguard](https://github.com/DefGuard/defguard) | Mailpit, `enrollment.spec.ts`, `passwordReset.spec.ts` | Playwright | enrollment, password reset | identified | Reset and enrollment links come back as one action |
| [onetimesecret/onetimesecret](https://github.com/onetimesecret/onetimesecret) | Mailpit, `e2e-full-auth.yml` | Playwright | signup, auth | identified | Full auth workflow in CI already. Drop the Mailpit service |
| [getprobo/probo](https://github.com/getprobo/probo) | `e2e/console/email_verification_test.go`, Mailpit | Go e2e | email verification | identified | REST API works from Go. Check fit before the message |
| [HiEventsDev/Hi.Events](https://github.com/HiEventsDev/Hi.Events) | Mailpit, `.github/workflows/e2e.yml`, agent skills in repo | Playwright | signup, orders | identified | They write tests with agents (`.claude/skills`). MCP fit |
| [invoicerr-app/invoicerr](https://github.com/invoicerr-app/invoicerr) | Mailpit, `cypress/e2e/01-register.cy.ts` | Cypress | register | identified | Small team, Cypress starter is ready |

Skip for now: large orgs with procurement (TryGhost, freeCodeCamp, Supabase), forks and course repos.

Statuses:

| Status | Meaning |
|--------|---------|
| `identified` | Found, no message yet |
| `contacted` | First message sent |
| `accepted` | Agreed to try |
| `key_created` | Got a Free key at /get-key |
| `ci_green` | Starter or own test green in CI |
| `staging_green` | Real signup flow passed on staging |
| `feedback_done` | Feedback recorded in [issue #5](https://github.com/navorina-labs/MailAgent/issues/5) |
| `declined` | Not a fit now |

## Good Candidate Profile

- Playwright or Cypress (or any HTTP client) in CI.
- Email in signup, login, invite or password reset.
- Already uses a mail testing service or a local SMTP container.
- Can add one CI secret without a security review.

## First Message

Keep it short and specific to their repo. Replace the bracketed parts.

```text
Hi [name],

I saw [repo] reads email in its e2e tests through [Mailosaur / Mailpit / ...] in [file].

I build Mail Agent: an inbox per test run, and the API returns the next step (OTP, magic link, reset link) instead of raw HTML. Works with Playwright and Cypress, has an MCP server for coding agents. Free plan: 10 inboxes, key at webmailagent.com/get-key.

Would you try it on one flow and tell me where it breaks? Happy to send a PR with the change for [flow].
```

## After They Say Yes

```text
Thanks. Steps:

1. Free key: https://webmailagent.com/get-key
2. Starter (Playwright): https://github.com/navorina-labs/MailAgent/tree/main/examples/qa-pilot-starter
   Cypress: https://github.com/navorina-labs/MailAgent/tree/main/examples/qa-pilot-cypress-starter
3. Add MAILAGENT_API_KEY as a CI secret, run npm test.

Then send me: setup time, what was unclear, and your staging signup URL if you want the real flow.
```

## Key Rules

- The candidate creates the key. We never ask for it.
- Never post a key in an issue, PR, screenshot or CI log.
- Record only status and feedback in issue #5.

## Feedback Questions

| Question | Target |
|----------|--------|
| Minutes from first message to green test? | under 30 |
| What was unclear? | docs, install, CI secret, sender preset |
| Did the email wait flake? | under 2% |
| Which sender do they use? | add a preset if missing |
| Would they keep it in CI? What would they pay? | yes or no, and why |

# Pilot invite: copy to an external QA team

Candidate list and first message: [PILOT-CANDIDATES.md](./PILOT-CANDIDATES.md). Operator checklist: [PILOT-ONBOARD.md](./PILOT-ONBOARD.md). Print this block:

```bash
npm run print:pilot-invite -- acme-pilot
```

## Email / Slack template

Replace `ACME`. The team creates its own Free key, so nothing secret goes in this message.

```text
Subject: Mail Agent pilot for ACME, about 30 minutes

Hi, here is the setup for the Mail Agent pilot: an inbox per test run instead of a shared mailbox.

1. Get a Free key (10 inboxes, 60 requests per minute):
   https://webmailagent.com/get-key

2. Copy the starter into your test repo:
   git clone https://github.com/navorina-labs/MailAgent.git /tmp/mailagent
   cp -R /tmp/mailagent/examples/qa-pilot-starter ./mailagent-qa
   cd mailagent-qa
   cp .env.example .env    # put MAILAGENT_API_KEY here
   npm install && npm test

   Cypress: examples/qa-pilot-cypress-starter

3. CI secrets:
   MAILAGENT_API_KEY = your key
   APP_SIGNUP_URL = https://your-staging.app/signup   (optional, for the real flow)

4. Conventions:
   label ci-$GITHUB_RUN_ID per job (built into the starter)
   set `service` to your mail sender preset (auth0, github, gitlab and others)
   the simulate test needs no SMTP; the staging test needs APP_SIGNUP_URL

Docs: https://webmailagent.com/docs/qa
Troubleshooting: https://webmailagent.com/docs/qa-troubleshooting
Reply with setup time and where you got stuck.
```

## After they reply

| Answer | Action |
|--------|--------|
| Green CI under 30 min | Ask for staging `APP_SIGNUP_URL` and the `service` preset |
| Timeout on wait | `debug.html?inbox=...`, diagnose link in the error |
| Wrong OTP | `subjectContains` or `messageIndex=1` |
| Missing preset | Backlog in `service-presets.ts` |
| Needs more than Free | Pro, or operator plan: `npm run team:plan -- TEAM_ID pro` |

Record in GitHub issue #5: `pilot: <team> feedback`.

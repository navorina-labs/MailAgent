# Pilot invite — copy to external QA team

Operator checklist: [PILOT-ONBOARD.md](./PILOT-ONBOARD.md). Generate this block:

```bash
npm run print:pilot-invite -- acme-pilot
```

## Email / Slack template

Replace `ACME` and send `MAILAGENT_API_KEY` in a **separate** DM (1Password / encrypted channel).

```text
Subject: MailAgent QA pilot — ~30 min setup

Hi — we're piloting MailAgent for disposable signup inboxes in CI (no shared Gmail).

1. Copy our starter into your test repo:
   https://github.com/navorina-labs/MailAgent/tree/main/examples/qa-pilot-starter

   git clone https://github.com/navorina-labs/MailAgent.git /tmp/mailagent
   cp -R /tmp/mailagent/examples/qa-pilot-starter ./mailagent-qa
   cd mailagent-qa

2. Local smoke:
   cp .env.example .env
   # MAILAGENT_API_KEY — we'll send separately (scoped to ci- labels)
   npm install && npm test

3. GitHub Actions (your repo → Settings → Secrets):
   MAILAGENT_API_KEY = <scoped key>
   (optional later) APP_SIGNUP_URL = https://your-staging.app/signup

4. Conventions:
   - label: ci-$GITHUB_RUN_ID per job (built into starter)
   - match `service` preset to your mail sender (auth0, github, gitlab, …)
   - simulate test works offline; staging test needs APP_SIGNUP_URL

Docs: https://webmailagent.com/docs/qa.html
Troubleshooting: https://webmailagent.com/docs/qa-troubleshooting.html
Feedback: reply with setup time + where you got stuck (see PILOT-ONBOARD.md)
```

## After they reply

| Answer | Action |
|--------|--------|
| Green CI < 30 min | Ask staging `APP_SIGNUP_URL` + `service` preset |
| Timeout on wait | `debug.html?inbox=…` · diagnose deep-link in error |
| Wrong OTP | `subjectContains` or `messageIndex=1` |
| Missing preset | backlog → `service-presets.ts` |

Record in GitHub issue: `pilot: <team> feedback`.

# Agent handoff — no human OTP checks

Use this when handing MailAgent to another AI agent, QA bot, Cursor/Codex session, or external test repo.

What can be automated:

- install/use the MailAgent MCP tools;
- mint short-lived scoped keys with `mailagent_issue_access` when an unrestricted team key is already available;
- create disposable inboxes;
- wait for OTP or magic links;
- diagnose failures;
- run simulate-first QA tests;
- keep server-side run state and resume after context loss with `mailagent_start_run` / `mailagent_report_run` / `mailagent_next_run`;
- ask for the next best tool/payload with `mailagent_plan_next`;
- choose presets with `mailagent_suggest_preset`;
- clean up test inboxes.

What still needs a human/private channel:

- providing a hosted `MAILAGENT_API_KEY`;
- adding CI secrets to a third-party repository;
- approving access to a private staging app.

Do not paste `ma_...`, `mak_...`, or `ci-...` keys into public issues, PRs, screenshots, logs, or agent prompts that may be stored publicly.

## Copy-paste prompt for an agent

```text
You are integrating MailAgent for email verification QA.

Goal:
- Use disposable inboxes for signup/login/password-reset email verification.
- Do not use Gmail or a shared mailbox.
- Do not run email reachability check on MailAgent temp inboxes.
- Use simulate-first tests before real SMTP/staging.

Setup:
1. Read https://github.com/navorina-labs/MailAgent/blob/main/AGENTS.md
2. Read https://github.com/navorina-labs/MailAgent/blob/main/docs/QA-PILOT.md
3. If using Codex/Cursor MCP:
   npx -y -p @mailagent/mcp@0.2.16 mailagent-mcp
4. Set:
   MAILAGENT_API_URL=https://api.webmailagent.com
   MAILAGENT_API_KEY=<provided privately>
5. Validate:
   npm run wizard:qa-pilot

Preferred flow:
- for autonomous multi-step browser work, start with mailagent_start_run, execute plan.nextTool, report each step with mailagent_report_run, resume with mailagent_next_run
- create inbox -> submit inbox.address in the app -> verify with inboxId
- use service preset when known, e.g. auth0, clerk, supabase, github
- when unsure what to do next, call mailagent_plan_next
- when sender/subject is unclear, call mailagent_suggest_preset first
- on timeout, call mailagent_plan_next with status=timeout or call mailagent_diagnose_inbox before retrying
- keep failed inboxes while debugging; delete successful runs

Pilot starter:
- copy examples/qa-pilot-starter for Playwright, or examples/qa-pilot-cypress-starter for Cypress
- run npm install && npm test
- then add APP_SIGNUP_URL only after simulate tests pass

Return:
- setup time
- whether simulate test passed
- whether staging signup passed
- missing service preset, confusing docs, timeout/diagnose gaps
```

## Fast paths

### Existing repo with MailAgent checked out

```bash
export MAILAGENT_API_URL=https://api.webmailagent.com
export MAILAGENT_API_KEY=<provided privately>
npm run wizard:qa-pilot
```

### Fresh QA repo

```bash
git clone https://github.com/navorina-labs/MailAgent.git /tmp/mailagent
cp -R /tmp/mailagent/examples/qa-pilot-starter ./mailagent-qa
cd mailagent-qa
cp .env.example .env
# edit .env: MAILAGENT_API_KEY=<provided privately>
npm install
npm test
```

Cypress:

```bash
cp -R /tmp/mailagent/examples/qa-pilot-cypress-starter ./mailagent-qa-cypress
cd mailagent-qa-cypress
cp .env.example .env
npm install
npm test
```

### MCP client

```bash
export MAILAGENT_API_URL=https://api.webmailagent.com
export MAILAGENT_API_KEY=<provided privately>
npx -y -p @mailagent/mcp@0.2.16 mailagent-mcp
```

Codex local:

```bash
codex mcp add mailagent -- npx -y -p @mailagent/mcp@0.2.16 mailagent-mcp
```

Remote MCP:

```text
POST https://api.webmailagent.com/mcp
Authorization: Bearer <MAILAGENT_API_KEY or mat_ token>
```

## Tool routing

| Situation | Use |
|-----------|-----|
| Need isolated temporary access for a run | `mailagent_issue_access` with `runId` / `labelPrefix` |
| Autonomous multi-step QA | `mailagent_start_run` -> execute `plan.nextTool` -> `mailagent_report_run` -> `mailagent_next_run` |
| Unsure what to do next | `mailagent_plan_next` |
| Pick next saved follow-up | `mailagent_next_run` with no active inbox flow; planner checks open Workspace reminders |
| Record Workspace progress | `mailagent_workspace_log_action`; read history with `mailagent_workspace_list_actions` |
| Unknown sender/service | `mailagent_suggest_preset` |
| Browser signup | `mailagent_create_inbox` -> form -> `mailagent_verify_signup` |
| One-shot smoke | `mailagent_verify_signup` without `inboxId` |
| CI without SMTP | `mailagent_simulate_message` |
| Timeout | `mailagent_diagnose_inbox` |
| Need raw evidence | `mailagent_list_messages`, `mailagent_get_raw_message`, attachments tools |
| Cleanup | `mailagent_cleanup_inboxes` with `labelPrefix` / `runId` |

## Access models

Hosted API:

- operator or dashboard issues a scoped key;
- key is added as local env var or CI secret;
- best for external QA pilot.

Self-host:

- no hosted key needed;
- follow [INTEGRATE.md](./INTEGRATE.md);
- use your own Cloudflare, Neon, Resend, and domain.

## Feedback contract

Ask the receiving agent/team to return:

| Field | Target |
|-------|--------|
| Setup time | under 30 minutes |
| Simulate result | green before staging |
| Staging result | pass/fail + service sender |
| Missing preset | sender, subject, auth provider |
| Diagnose quality | clear/unclear next step |
| Flake rate | target under 2% |

Record feedback in issue [#5](https://github.com/navorina-labs/MailAgent/issues/5) or in a private operator note without secrets.

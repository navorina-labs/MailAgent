# @mailagent/qa

Playwright / Cypress helpers for [MailAgent](https://agents.navorina.ai) test inboxes.

```bash
npm install @mailagent/qa
```

## Playwright

```ts
import { createMailAgentQa, MailAgentQa } from "@mailagent/qa";

const mail = createMailAgentQa();
const inbox = await mail.createInbox({ label: MailAgentQa.ciLabel(), service: "auth0" });
const { otp } = await mail.waitForVerification(inbox.id, { subjectContains: "verify" });
// callback flow:
// const { verification } = await mail.waitForCallback(inbox.id, { since: new Date() });
await mail.cleanupRun(process.env.GITHUB_RUN_ID!);
```

Fixture: [examples/playwright/mailagent.fixture.ts](../../examples/playwright/mailagent.fixture.ts).

## CI failure artifact

On timeout or failed email step, attach a safe JSON artifact and optionally write
to `$GITHUB_STEP_SUMMARY`:

```ts
import {
  createMailAgentQa,
  formatFailureArtifactAttachment,
  writeFailureArtifact,
} from "@mailagent/qa";

const ctx = await mail.getDebugContext(inbox.id, { subjectContains: "verify" });
await testInfo.attach("mailagent-failure.json", {
  body: formatFailureArtifactAttachment(ctx).body,
  contentType: "application/json",
});
await writeFailureArtifact(ctx, { writeGitHubStepSummary: true });
```

The artifact includes failure summary, recommended action, retry payload,
messages, callbacks, and debug UI URL. Full OTP values and magic links are
redacted unless `includeOtp` / `includeLinks` is explicitly enabled.

## Cypress

`cypress.config.ts`:

```ts
import { createMailAgentCypressTasks } from "@mailagent/qa/cypress";

export default defineConfig({
  e2e: {
    setupNodeEvents(on) {
      on("task", createMailAgentCypressTasks());
    },
  },
});
```

Spec: [examples/cypress/signup-email.cy.example.ts](../../examples/cypress/signup-email.cy.example.ts).

Tasks: `mailagentRunLabel`, `mailagentCreateInbox`, `mailagentWaitVerification`, `mailagentSimulateAndVerify`, `mailagentOpen`, `mailagentDeleteInbox`, `mailagentCleanupRun`.

## Docs

- [QA guide](https://agents.navorina.ai/docs/qa.html)
- [Troubleshooting](../../docs/QA-TROUBLESHOOTING.md)
- [Local SMTP (Mailpit)](../../docs/QA-LOCAL-SMTP.md)
- [Service presets](../../docs/QA-PRESETS.md)
- [Callback cookbook](../../docs/QA-CALLBACK.md)

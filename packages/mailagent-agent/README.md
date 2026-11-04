# @mailagent/agent

Minimal SDK for [MailAgent](https://agents.navorina.ai) agent flows.

```bash
npm install @mailagent/agent
```

```ts
import { MailAgent } from "@mailagent/agent";

const mail = new MailAgent({
  baseUrl: "https://mail-api.navorina.ai",
  apiKey: process.env.MAILAGENT_API_KEY!,
});

const step1 = await mail.verifySignup({
  service: "github",
  runId: "my-agent-session",
  timeoutSeconds: 5,
  deleteAfter: false,
});
// step1.email.address → signup form

const step2 = await mail.verifySignup({
  inboxId: step1.email!.inboxId,
  timeoutSeconds: 90,
});
console.log(step2.agent?.primaryAction);
```

See [Agent docs](https://agents.navorina.ai/docs/agents.html).

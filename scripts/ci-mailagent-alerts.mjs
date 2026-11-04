#!/usr/bin/env node
/**
 * CI: Slack + PR comment on email test failure.
 * Env: MAILAGENT_API_URL, MAILAGENT_API_KEY, GITHUB_RUN_ID,
 *      MAILAGENT_SLACK_WEBHOOK (optional), GH_TOKEN + pull_request event
 */
import "./load-env.mjs";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createMailAgentQa } from "../packages/mailagent-qa/dist/index.js";
import {
  formatPrCommentMailFailure,
  notifySlackOnMailFailure,
} from "../packages/mailagent-qa/dist/notify.js";

const runId = process.env.GITHUB_RUN_ID ?? process.env.RUN_ID;
const slackWebhook = process.env.MAILAGENT_SLACK_WEBHOOK;
const ghToken = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
const eventName = process.env.GITHUB_EVENT_NAME;

function prNumberFromEvent() {
  const direct = process.env.GITHUB_EVENT_PULL_REQUEST_NUMBER;
  if (direct) return direct;
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path) return undefined;
  try {
    const ev = JSON.parse(readFileSync(path, "utf8"));
    return ev.pull_request?.number != null ? String(ev.pull_request.number) : undefined;
  } catch {
    return undefined;
  }
}

if (!runId) {
  console.error("ci-mailagent-alerts: set GITHUB_RUN_ID");
  process.exit(1);
}

const mail = createMailAgentQa();
const labelPrefix = `ci-${runId}`;
const prNumber = prNumberFromEvent();

const meta = {
  workflow: process.env.GITHUB_WORKFLOW,
  runUrl:
    process.env.GITHUB_SERVER_URL &&
    process.env.GITHUB_REPOSITORY &&
    runId
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${runId}`
      : undefined,
  repo: process.env.GITHUB_REPOSITORY,
  branch: process.env.GITHUB_REF_NAME,
};

async function main() {
  const inboxes = await mail.listInboxesByPrefix(labelPrefix).catch(() => []);
  console.log("mailagent alerts:", labelPrefix, "inboxes=", inboxes.length);

  const contexts = await Promise.all(
    inboxes.map((box) =>
      mail.getDebugContext(box.id, { address: box.address, label: box.label })
    )
  );

  if (contexts.length === 0) {
    contexts.push({
      inboxId: "(unknown)",
      apiMessagesUrl: "",
      debugUiUrl: "https://agents.navorina.ai/debug.html",
      messages: [],
    });
  }

  if (slackWebhook) {
    const ok = await notifySlackOnMailFailure(slackWebhook, contexts, meta);
    console.log("slack:", ok ? "sent" : "skipped");
  } else {
    console.log("slack: skipped (no MAILAGENT_SLACK_WEBHOOK)");
  }

  if (eventName === "pull_request" && prNumber && ghToken) {
    const body = formatPrCommentMailFailure(contexts, meta);
    const r = spawnSync("gh", ["pr", "comment", prNumber, "--body", body], {
      env: { ...process.env, GH_TOKEN: ghToken },
      stdio: "inherit",
    });
    if (r.status !== 0) {
      console.error("gh pr comment failed", r.status);
      process.exit(r.status ?? 1);
    }
    console.log("pr comment: posted on #" + prNumber);
  } else {
    console.log("pr comment: skipped (not a PR or no GH_TOKEN)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

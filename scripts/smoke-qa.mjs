#!/usr/bin/env node
/** Smoke QA REST flow: inbox lifecycle (no real email required) */
import "./load-env.mjs";
import { apiOrigin } from "./lib/public-origins.mjs";

const base = apiOrigin();
const apiKey = process.env.MAILAGENT_API_KEY ?? process.env.API_KEY;

if (!apiKey) {
  console.error("Set MAILAGENT_API_KEY");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json",
};

async function req(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 200) };
    }
  }
  return { res, json };
}

async function main() {
  console.log("Smoke QA →", base);
  const label = `smoke-qa-${Date.now()}`;

  const me = await req("GET", "/v1/me");
  console.log("GET /v1/me", me.res.status, me.json?.scope ? "scope=ok" : "");
  if (!me.res.ok) process.exit(1);

  const agent = await req("GET", "/v1/agent");
  const tools = agent.json?.mcpTools ?? [];
  console.log("GET /v1/agent", agent.res.status, `mcpTools=${tools.length}`);
  if (!agent.res.ok) process.exit(1);
  for (const name of [
    "mailagent_verify_signup",
    "mailagent_create_inbox",
    "mailagent_list_messages",
    "mailagent_diagnose_inbox",
    "mailagent_simulate_message",
    "mailagent_send_message",
    "mailagent_list_threads",
    "mailagent_search_messages",
    "mailagent_extract_structured",
  ]) {
    if (!tools.includes(name)) {
      console.error("missing mcpTool on API:", name);
      process.exit(1);
    }
  }
  const wantAttach = process.env.SMOKE_EXPECT_ATTACHMENTS === "1";
  if (wantAttach) {
    for (const name of [
      "mailagent_list_attachments",
      "mailagent_get_attachment",
    ]) {
      if (!tools.includes(name)) {
        console.error("deploy v0.7+ required, missing:", name);
        process.exit(1);
      }
    }
  } else if (
    !tools.includes("mailagent_list_attachments")
  ) {
    console.log(
      "hint: after merge main, rerun with SMOKE_EXPECT_ATTACHMENTS=1"
    );
  }

  const created = await req("POST", "/v1/inboxes", {
    label,
    ttlMinutes: 15,
    service: "github",
  });
  console.log("POST /v1/inboxes", created.res.status, created.json?.id ?? created.json?.error);
  if (!created.res.ok || !created.json?.id) process.exit(1);

  const inboxId = created.json.id;

  const messages = await req("GET", `/v1/inboxes/${inboxId}/messages`);
  console.log(
    "GET …/messages",
    messages.res.status,
    `count=${messages.json?.messages?.length ?? 0}`
  );
  if (!messages.res.ok) process.exit(1);

  const callbacks = await req("GET", `/v1/inboxes/${inboxId}/callbacks`);
  console.log(
    "GET …/callbacks",
    callbacks.res.status,
    `deliveries=${callbacks.json?.deliveries?.length ?? 0}`
  );
  if (!callbacks.res.ok) process.exit(1);

  const wait = await req(
    "GET",
    `/v1/inboxes/${inboxId}/wait?timeout=5&subjectContains=__smoke_none__`
  );
  console.log("GET …/wait (expect 408)", wait.res.status);
  if (wait.res.status !== 408) process.exit(1);
  if (!Array.isArray(wait.json?.troubleshooting) && !wait.json?.hint) {
    console.error("408 missing hint/troubleshooting");
    process.exit(1);
  }

  const diagnose = await req(
    "GET",
    `/v1/inboxes/${inboxId}/diagnose?subjectContains=__smoke_none__`
  );
  console.log(
    "GET …/diagnose",
    diagnose.res.status,
    `troubleshooting=${diagnose.json?.troubleshooting?.length ?? 0}`,
    `action=${diagnose.json?.recommendedAction?.type ?? "?"}`
  );
  if (!diagnose.res.ok || !diagnose.json?.debugUiUrl) process.exit(1);
  if (process.env.MAILAGENT_REQUIRE_DIAGNOSE_RECOVERY === "1" && (
    diagnose.json?.failureSummary?.code !== "no_messages" ||
    diagnose.json?.recommendedAction?.type !== "wait" ||
    !diagnose.json?.retry?.wait?.path
  )) {
    console.error("diagnose missing recovery hints");
    process.exit(1);
  }

  const sim = await req("POST", `/v1/inboxes/${inboxId}/simulate`, {
    otp: "991122",
    subject: "smoke-qa simulate",
  });
  console.log("POST …/simulate", sim.res.status, sim.json?.messageId ?? sim.json?.error);
  if (!sim.res.ok || !sim.json?.messageId) process.exit(1);

  const simReply = await req("POST", `/v1/inboxes/${inboxId}/simulate`, {
    otp: "991123",
    subject: "Re: smoke-qa simulate",
    inReplyToMessageId: sim.json.messageId,
  });
  console.log(
    "POST …/simulate (reply)",
    simReply.res.status,
    simReply.json?.threadId ?? simReply.json?.error
  );
  if (!simReply.res.ok || !simReply.json?.threadId) process.exit(1);
  const rootThread = sim.json.threadId ?? sim.json.messageId;
  if (simReply.json.threadId !== rootThread) {
    console.error("thread id mismatch after reply simulate");
    process.exit(1);
  }

  const threads = await req("GET", `/v1/inboxes/${inboxId}/threads`);
  console.log(
    "GET …/threads",
    threads.res.status,
    `count=${threads.json?.threads?.length ?? 0}`
  );
  if (!threads.res.ok) process.exit(1);

  const extract = await req("GET", `/v1/inboxes/${inboxId}/extract`);
  console.log(
    "GET …/extract",
    extract.res.status,
    extract.json?.otp ?? "—",
    `confidence=${extract.json?.confidence ?? "?"}`
  );
  if (!extract.res.ok || extract.json?.otp !== "991123") process.exit(1);
  if (
    process.env.MAILAGENT_REQUIRE_VERIFICATION_CONFIDENCE === "1" &&
    (extract.json?.confidence !== "high" ||
      extract.json?.matchedRule !== "otp_6_digit" ||
      !extract.json?.reason ||
      !extract.json?.alternatives)
  ) {
    console.error("extract missing verification confidence metadata");
    process.exit(1);
  }

  if (process.env.MAILAGENT_REQUIRE_HTML_ACTIONS === "1") {
    const simMagic = await req("POST", `/v1/inboxes/${inboxId}/simulate`, {
      scenario: "magic_link",
      subject: "smoke-qa magic link",
    });
    console.log(
      "POST …/simulate (magic_link)",
      simMagic.res.status,
      simMagic.json?.messageId ?? simMagic.json?.error
    );
    if (!simMagic.res.ok || !simMagic.json?.messageId) process.exit(1);

    const htmlExtract = await req("GET", `/v1/inboxes/${inboxId}/extract`);
    console.log(
      "GET …/extract (html actions)",
      htmlExtract.res.status,
      htmlExtract.json?.primaryButton?.text ?? "—"
    );
    if (
      !htmlExtract.res.ok ||
      htmlExtract.json?.primaryButton?.text !== "Verify email" ||
      !htmlExtract.json?.primaryButton?.href ||
      !String(htmlExtract.json?.visibleText ?? "").includes("Verify email") ||
      !Array.isArray(htmlExtract.json?.filteredLinks)
    ) {
      console.error("extract missing html action metadata");
      process.exit(1);
    }
  }

  const del = await req("DELETE", `/v1/inboxes/${inboxId}`);
  console.log("DELETE inbox", del.res.status);
  if (!del.res.ok) process.exit(1);

  console.log("OK — QA REST lifecycle");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

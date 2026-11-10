#!/usr/bin/env node
/** Smoke remote MCP (OAuth + Streamable HTTP) + agent API */
import "./load-env.mjs";
import { apiOrigin } from "./lib/public-origins.mjs";

const base = apiOrigin();
const apiKey = process.env.MAILAGENT_API_KEY ?? process.env.API_KEY;

if (!apiKey) {
  console.error("Set MAILAGENT_API_KEY");
  process.exit(1);
}

const jsonHeaders = {
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

/** Parse JSON bodies; surface plain-text 5xx from Workers instead of throwing. */
async function readJson(res) {
  const text = await res.text();
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

async function main() {
  console.log("Smoke agent →", base);

  const agent = await fetch(`${base}/v1/agent`, { headers: jsonHeaders });
  const agentJson = await agent.json();
  console.log("GET /v1/agent", agent.status, agentJson.version ?? "", agentJson.auth?.oidc ?? "");
  if (!agent.ok) process.exit(1);
  if (process.env.MAILAGENT_REQUIRE_RUN_TIMELINE === "1") {
    if (
      !agentJson.runs?.timeline ||
      !agentJson.mcpTools?.includes("mailagent_get_run_timeline")
    ) {
      console.error("run timeline discovery missing", agentJson.runs, agentJson.mcpTools);
      process.exit(1);
    }
  }
  if (process.env.MAILAGENT_REQUIRE_CLEANUP_POLICIES === "1") {
    if (
      !agentJson.recommended?.verify?.cleanupPolicy ||
      !agentJson.mcpTools?.includes("mailagent_cleanup_inboxes")
    ) {
      console.error("cleanup policy discovery missing", {
        recommended: agentJson.recommended?.verify,
        mcpTools: agentJson.mcpTools,
      });
      process.exit(1);
    }
  }
  if (process.env.MAILAGENT_REQUIRE_AGENT_FLOWS === "1") {
    const flowIds = agentJson.flowTemplates?.ids ?? [];
    for (const id of ["signup", "login_2fa", "password_reset", "invite_accept", "magic_link_login"]) {
      if (!flowIds.includes(id)) {
        console.error("agent flow template missing", id, agentJson.flowTemplates);
        process.exit(1);
      }
    }
    const flows = await fetch(`${base}/v1/agent/flows`, { headers: jsonHeaders });
    const flowsJson = await flows.json();
    console.log("GET /v1/agent/flows", flows.status, flowsJson.flows?.length ?? 0);
    if (!flows.ok || !Array.isArray(flowsJson.flows) || flowsJson.flows.length < 5) {
      process.exit(1);
    }
  }

  const discovery = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);
  console.log("GET oauth-protected-resource/mcp", discovery.status);
  if (!discovery.ok) process.exit(1);

  const authServer = await fetch(`${base}/.well-known/oauth-authorization-server`);
  const authMeta = await authServer.json();
  console.log(
    "GET oauth-authorization-server",
    authServer.status,
    authMeta.registration_endpoint ? "DCR=ok" : "DCR=missing"
  );
  if (!authServer.ok || !authMeta.registration_endpoint) process.exit(1);

  let dcrSecret = null;
  const regRes = await fetch(`${base}/v1/oauth/register`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ client_name: "smoke-dcr" }),
  });
  if (regRes.status === 403) {
    console.log("POST /v1/oauth/register skipped (legacy key, no team)");
  } else {
    const regJson = await regRes.json();
    console.log(
      "POST /v1/oauth/register",
      regRes.status,
      regJson.client_id ?? regJson.error
    );
    if (!regRes.ok || !regJson.client_secret) process.exit(1);
    dcrSecret = regJson.client_secret;

    const clientMeta = await fetch(
      `${base}/v1/oauth/clients/${regJson.client_id.replace(/^mac_/, "")}`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    console.log("GET /v1/oauth/clients/:id", clientMeta.status);
    if (!clientMeta.ok) process.exit(1);
  }

  const tokenRes = await fetch(`${base}/v1/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_secret: apiKey,
    }),
  });
  const { json: tokenJson, text: tokenText } = await readJson(tokenRes);
  let accessToken = tokenJson?.access_token;
  let oauthViaMat = true;
  if (!tokenRes.ok || !accessToken) {
    const detail =
      tokenJson?.error_description ??
      tokenJson?.error ??
      tokenText?.slice(0, 80) ??
      "unknown";
    console.log("POST /v1/oauth/token", tokenRes.status, detail);
    console.log("POST /v1/oauth/token → fallback direct API key (mat_ needs KV)");
    accessToken = apiKey;
    oauthViaMat = false;
  } else {
    console.log(
      "POST /v1/oauth/token",
      tokenRes.status,
      `mat_${accessToken.slice(4, 12)}…`
    );
  }

  const oauthHeaders = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const init = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: oauthHeaders,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "smoke-agent", version: "1.0" },
      },
    }),
  });
  const { json: initJson, text: initText } = await readJson(init);
  let sessionId = init.headers.get("Mcp-Session-Id");
  console.log(
    "POST /mcp initialize",
    init.status,
    "session=",
    sessionId ? `${sessionId.slice(0, 8)}…` : "(none)"
  );
  if (!init.ok || !initJson?.result) {
    console.log(
      "POST /mcp initialize → continue without session",
      initText?.slice(0, 80) ?? initJson?.error?.message ?? ""
    );
    sessionId = null;
  }

  const mcpHeaders = {
    ...oauthHeaders,
    ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
  };

  const mcp = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: mcpHeaders,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    }),
  });
  const { json: mcpJson } = await readJson(mcp);
  const tools = mcpJson.result?.tools?.length ?? 0;
  console.log("POST /mcp tools/list", mcp.status, `tools=${tools}`);
  if (!mcp.ok || tools < 1) process.exit(1);

  const unauth = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "ping" }),
  });
  const www = unauth.headers.get("WWW-Authenticate");
  console.log("POST /mcp unauth", unauth.status, www ? "WWW-Authenticate=ok" : "");
  if (unauth.status !== 401) process.exit(1);

  const created = await fetch(`${base}/v1/inboxes`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      label: `smoke-progress-${Date.now()}`,
      ttlMinutes: 5,
    }),
  });
  const inbox = await created.json();
  if (!created.ok) {
    console.error("create inbox for progress smoke failed", inbox);
    process.exit(1);
  }

  const streamRes = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "mailagent_wait_for_message",
        arguments: { inboxId: inbox.id, timeoutSeconds: 4 },
      },
    }),
  });
  const streamText = await streamRes.text();
  const progressCount = (streamText.match(/notifications\/progress/g) ?? []).length;
  console.log(
    "POST /mcp wait stream",
    streamRes.status,
    streamRes.headers.get("content-type"),
    `progress=${progressCount}`
  );
  if (!streamRes.ok || progressCount < 1) process.exit(1);

  await fetch(`${base}/v1/inboxes/${inbox.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (sessionId) {
    await fetch(`${base}/mcp`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Mcp-Session-Id": sessionId,
      },
    });
  }

  const runs = await fetch(`${base}/v1/agent/runs?limit=1`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  console.log("GET /v1/agent/runs", runs.status);
  if (!runs.ok) process.exit(1);

  console.log("OK", {
    version: agentJson.version,
    mcpTools: tools,
    oauth: oauthViaMat ? "mat_token" : "api_key_direct",
    dcr: dcrSecret ? "registered" : "skipped",
    session: !!sessionId,
    progress: progressCount,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

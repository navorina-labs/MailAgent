/** Remote MCP: JSON-RPC + Streamable HTTP (SSE sessions) */
import { Hono, type Context } from "hono";
import type { Env } from "../env";
import type { ApiVariables } from "../lib/api-context";
import { publicOriginFromUrl, workspaceUrl } from "../lib/public-origin";
import type { ApiKeyScope } from "../lib/key-scope";
import { requireMcpAuth } from "../lib/auth";
import { rateLimit } from "../lib/rate-limit";
import { executeMcpTool } from "../mcp/handlers";
import { isWaitTool, progressNotification } from "../mcp/progress";
import { MCP_SERVER_INFO, MCP_TOOLS } from "../mcp/manifest";
import {
  createMcpSession,
  deleteMcpSession,
  validateMcpSession,
} from "../mcp/session";
import { isOidcEnabled } from "../services/oidc-oauth";
import { jsonRpcAsSse, mcpSseSessionStream, sseResponse } from "../mcp/sse-response";

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

export const mcpHttpRoutes = new Hono<{ Bindings: Env; Variables: ApiVariables }>();

mcpHttpRoutes.use("*", requireMcpAuth);
mcpHttpRoutes.use("*", rateLimit);

mcpHttpRoutes.get("/auth", (c) => {
  const apiOrigin = publicOriginFromUrl(c.req.url, c.env.MAILAGENT_PUBLIC_API_ORIGIN);
  const oidc = isOidcEnabled(c.env);
  return c.json({
    type: "oauth2",
    flows: {
      clientCredentials: {
        tokenUrl: `${apiOrigin}/v1/oauth/token`,
        scopes: ["mcp:tools"],
      },
      ...(oidc
        ? {
            authorizationCode: {
              authorizeUrl: `${apiOrigin}/v1/oauth/authorize`,
              tokenUrl: `${apiOrigin}/v1/oauth/token`,
              scopes: ["mcp:tools", "openid", "profile", "email"],
              pkce: true,
            },
          }
        : {}),
    },
    directApiKey: {
      header: "Authorization",
      format: "Bearer <API_KEY>",
      note: "API key works directly without token exchange",
    },
    discovery: {
      authorizationServer: `${apiOrigin}/.well-known/oauth-authorization-server`,
      protectedResource: `${apiOrigin}/.well-known/oauth-protected-resource/mcp`,
    },
    issue: "npm run issue:key:db or /dashboard.html",
    oidc: oidc ? "enabled" : "disabled",
    docs: workspaceUrl("/docs/oauth-idp.html", c.env.MAILAGENT_WORKSPACE_ORIGIN),
  });
});

mcpHttpRoutes.get("/", (c) => {
  const accept = c.req.header("Accept") ?? "";
  if (accept.includes("text/event-stream")) {
    return handleMcpSseGet(c);
  }

  return c.json({
    protocol: "mcp",
    transports: ["http-jsonrpc", "streamable-http"],
    protocolVersions: ["2024-11-05", "2025-03-26"],
    endpoint: "POST /mcp",
    sse: "GET /mcp with Accept: text/event-stream and Mcp-Session-Id",
    session: "Mcp-Session-Id header (assigned on initialize)",
    auth: "Authorization: Bearer <API_KEY>",
    progress: "POST tools/call with Accept: text/event-stream on wait tools",
    tools: MCP_TOOLS.length,
    docs: workspaceUrl("/docs/agents.html#remote-mcp", c.env.MAILAGENT_WORKSPACE_ORIGIN),
  });
});

mcpHttpRoutes.delete("/", async (c) => {
  const sessionId = c.req.header("Mcp-Session-Id")?.trim();
  if (!sessionId) {
    return c.json({ error: "Mcp-Session-Id required" }, 400);
  }
  const ok = await validateMcpSession(c.env, sessionId, c.get("apiKeyHint"));
  if (!ok) {
    return c.json({ error: "session_not_found" }, 404);
  }
  await deleteMcpSession(c.env, sessionId);
  return new Response(null, { status: 204 });
});

mcpHttpRoutes.post("/", (c) => handleJsonRpc(c));

async function handleMcpSseGet(c: Ctx) {
  const sessionId = c.req.header("Mcp-Session-Id")?.trim();
  if (!sessionId) {
    return c.json({ error: "Mcp-Session-Id required for SSE GET" }, 400);
  }
  const ok = await validateMcpSession(c.env, sessionId, c.get("apiKeyHint"));
  if (!ok) {
    return c.json({ error: "session_not_found" }, 404);
  }

  const stream = mcpSseSessionStream(c.env, sessionId, c.req.raw.signal);
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Mcp-Session-Id": sessionId,
    },
  });
}

async function handleJsonRpc(c: Ctx) {
  let body: JsonRpcRequest | JsonRpcRequest[];
  try {
    body = await c.req.json();
  } catch {
    return rpcHttpResponse(rpcError(null, -32700, "Parse error"), 400);
  }

  const auth = {
    apiKeyHint: c.get("apiKeyHint"),
    teamId: c.get("teamId"),
    plan: c.get("apiPlan"),
    scope: c.get("apiKeyScope"),
  };

  const sessionIn = c.req.header("Mcp-Session-Id")?.trim();
  const accept = c.req.header("Accept") ?? "";
  const wantsSse = accept.includes("text/event-stream");

  if (Array.isArray(body)) {
    let sessionId = sessionIn;
    const results: JsonRpcResponse[] = [];
    for (const req of body) {
      const out = await dispatchRpcWithSession(c.env, auth, req, sessionId, wantsSse);
      if (out.sessionId && !sessionId) sessionId = out.sessionId;
      if (out.result) results.push(out.result);
    }
    return rpcHttpResponse(results, 200, wantsSse, sessionId);
  }

  if (
    body.method === "tools/call" &&
    wantsSse &&
    isWaitTool(String(body.params?.name ?? ""))
  ) {
    const sessionOut = await resolveSession(c.env, auth, body, sessionIn);
    if (sessionOut.error) {
      return rpcHttpResponse(sessionOut.error, sessionOut.status ?? 404, false, sessionIn);
    }
    return streamToolCall(
      c.env,
      auth,
      body.id ?? null,
      String(body.params?.name),
      (body.params?.arguments ?? {}) as Record<string, unknown>,
      sessionOut.sessionId
    );
  }

  const { result, sessionId, status } = await dispatchRpcWithSession(
    c.env,
    auth,
    body,
    sessionIn,
    wantsSse
  );
  if (result === null) {
    return new Response(null, { status: 204 });
  }
  return rpcHttpResponse(result, status, wantsSse, sessionId);
}

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

async function resolveSession(
  env: Env,
  auth: { apiKeyHint: string; teamId: string | null; plan: import("../lib/plans").PlanId; scope: ApiKeyScope },
  req: JsonRpcRequest,
  sessionIn?: string
): Promise<{
  sessionId?: string;
  error?: JsonRpcResponse;
  status?: number;
}> {
  if (sessionIn) {
    const ok = await validateMcpSession(env, sessionIn, auth.apiKeyHint);
    if (!ok) {
      return {
        error: rpcError(req.id ?? null, -32001, "session_not_found"),
        status: 404,
      };
    }
    return { sessionId: sessionIn };
  }
  if (req.method === "initialize") {
    try {
      const created = await createMcpSession(env, auth);
      if (created) return { sessionId: created };
    } catch {
      /* KV quota */
    }
  }
  return { sessionId: sessionIn };
}

function streamToolCall(
  env: Env,
  auth: { apiKeyHint: string; teamId: string | null; plan: import("../lib/plans").PlanId; scope: ApiKeyScope },
  id: string | number | null,
  name: string,
  toolArgs: Record<string, unknown>,
  sessionId?: string
): Response {
  const headers: Record<string, string> = {};
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const write = (payload: unknown) => {
        controller.enqueue(enc.encode(jsonRpcAsSse(payload)));
      };

      try {
        const result = await executeMcpTool(env, auth, name, toolArgs, {
          onProgress: async (params) => {
            const note = progressNotification(params);
            write(note);
            // Progress is already on this SSE stream; skip KV relay (saves KV puts).
          },
        });
        write({ jsonrpc: "2.0", id, result });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        write({
          jsonrpc: "2.0",
          id,
          error: { code: -32603, message },
        });
      } finally {
        controller.close();
      }
    },
  });

  return sseResponse(stream, headers);
}

async function dispatchRpcWithSession(
  env: Env,
  auth: { apiKeyHint: string; teamId: string | null; plan: import("../lib/plans").PlanId; scope: ApiKeyScope },
  req: JsonRpcRequest,
  sessionIn?: string,
  _wantsSse = false
): Promise<{
  result: JsonRpcResponse | null;
  sessionId?: string;
  status: number;
}> {
  if (sessionIn) {
    const ok = await validateMcpSession(env, sessionIn, auth.apiKeyHint);
    if (!ok) {
      return {
        result: rpcError(req.id ?? null, -32001, "session_not_found"),
        status: 404,
      };
    }
  }

  let sessionId = sessionIn;
  if (req.method === "initialize" && !sessionIn) {
    try {
      const created = await createMcpSession(env, auth);
      if (created) sessionId = created;
    } catch {
      /* KV quota — initialize still succeeds without session */
    }
  }

  const result = await dispatchRpc(env, auth, req);
  return { result, sessionId, status: 200 };
}

async function dispatchRpc(
  env: Env,
  auth: { apiKeyHint: string; teamId: string | null; plan: import("../lib/plans").PlanId; scope: ApiKeyScope },
  req: JsonRpcRequest
): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;
  if (req.method?.startsWith("notifications/")) {
    return null;
  }
  if (!req.method) {
    return rpcError(id, -32600, "Invalid Request");
  }

  try {
    switch (req.method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {}, progress: true },
            serverInfo: {
              ...MCP_SERVER_INFO,
              transport: "streamable-http",
            },
          },
        };

      case "tools/list":
        return {
          jsonrpc: "2.0",
          id,
          result: { tools: MCP_TOOLS },
        };

      case "tools/call": {
        const params = req.params ?? {};
        const name = params.name as string;
        const toolArgs = (params.arguments ?? {}) as Record<string, unknown>;
        if (!name) {
          return rpcError(id, -32602, "Missing tool name");
        }
        const out = await executeMcpTool(env, auth, name, toolArgs);
        return { jsonrpc: "2.0", id, result: out };
      }

      case "ping":
        return { jsonrpc: "2.0", id, result: {} };

      default:
        return rpcError(id, -32601, `Method not found: ${req.method}`);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return rpcError(id, -32603, message);
  }
}

function rpcHttpResponse(
  payload: JsonRpcResponse | JsonRpcResponse[],
  status: number,
  wantsSse = false,
  sessionId?: string
): Response {
  const headers: Record<string, string> = {};
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  if (wantsSse) {
    const body = Array.isArray(payload)
      ? payload.map((p) => jsonRpcAsSse(p)).join("")
      : jsonRpcAsSse(payload);
    return sseResponse(body, headers);
  }

  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, data },
  };
}

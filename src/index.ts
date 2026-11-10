import { Hono } from "hono";
import { webhookSecretRoutes } from "./routes/webhook-secret";
import { withSecurityHeaders } from "./lib/security-headers";
import { cors } from "hono/cors";
import { InboxWait } from "./durable-objects/inbox-wait";
import type { Env, EmailQueueMessage } from "./env";
import { handleQueueBatch } from "./queue/consumer";
import { apiMetaRoutes } from "./routes/api-meta";
import { openapiRoutes } from "./routes/openapi";
import { healthRoutes } from "./routes/health";
import { statusRoutes } from "./routes/status";
import { inboxRoutes } from "./routes/inboxes";
import { statsRoutes } from "./routes/stats";
import { meRoutes } from "./routes/me";
import { billingRoutes } from "./routes/billing";
import { consoleRoutes } from "./routes/console";
import { teamRoutes } from "./routes/team";
import { domainRoutes } from "./routes/domains";
import { agentRoutes } from "./routes/agent";
import { mcpHttpRoutes } from "./routes/mcp-http";
import { isApiPath } from "./lib/api-path";
import { keySignupRoutes } from "./routes/key-signup";
import { upgradeRoutes } from "./routes/upgrade";
import { pilotRoutes } from "./routes/pilot";
import { oauthTokenRoutes, wellKnownRoutes } from "./routes/oauth";
import { webhookRoutes } from "./routes/webhooks";
import { purgeExpired } from "./services/inbox";
import { purgeExpiredAuditEvents } from "./services/audit-log";
import { runDueWorkspaceMonitors } from "./services/workspace-monitor-runner";
import { auditRoutes } from "./routes/audit";
import { emailRoutes } from "./routes/emails";
import { workspaceRoutes } from "./routes/workspace";
import { isInsecureRequest } from "./lib/public-origin";

export { InboxWait };

const app = new Hono<{ Bindings: Env }>();

const ALLOWED_CORS_ORIGINS = new Set([
  "https://webmailagent.com",
  "https://www.webmailagent.com",
  "https://api.webmailagent.com",
  "https://agents.navorina.ai",
  "https://mail-api.navorina.ai",
  "http://127.0.0.1:8787",
  "http://localhost:8787",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
]);

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (ALLOWED_CORS_ORIGINS.has(origin)) return origin;
      try {
        const url = new URL(origin);
        if (
          (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
          (url.protocol === "http:" || url.protocol === "https:")
        ) {
          return origin;
        }
      } catch {
        /* ignore invalid Origin */
      }
      return null;
    },
    allowHeaders: [
      "Authorization",
      "Content-Type",
      "Accept",
      "Mcp-Session-Id",
      "MCP-Protocol-Version",
    ],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: [
      "Mcp-Session-Id",
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
      "X-RateLimit-Reset",
    ],
    maxAge: 600,
  })
);

app.route("/", healthRoutes);
app.route("/webhooks", webhookRoutes);
app.route("/v1", statusRoutes);
app.route("/v1", apiMetaRoutes);
app.route("/v1", openapiRoutes);
app.route("/v1/inboxes", inboxRoutes);
app.route("/v1/stats", statsRoutes);
app.route("/v1/me", meRoutes);
app.route("/v1/webhook-secret", webhookSecretRoutes);
app.route("/v1/billing", billingRoutes);
app.route("/v1/console", consoleRoutes);
app.route("/v1/audit", auditRoutes);
app.route("/v1/team", teamRoutes);
app.route("/v1/domains", domainRoutes);
app.route("/v1/emails", emailRoutes);
app.route("/v1/pilot-requests", pilotRoutes);
app.route("/v1/keys", keySignupRoutes);
app.route("/v1/upgrade", upgradeRoutes);
app.route("/v1/agent", agentRoutes);
app.route("/v1/workspace", workspaceRoutes);
app.route("/v1/oauth", oauthTokenRoutes);
app.route("/mcp", mcpHttpRoutes);
app.route("/", wellKnownRoutes);

app.notFound((c) => c.json({ error: "not_found" }, 404));

const HTTPS_HOSTS = new Set([
  "webmailagent.com",
  "www.webmailagent.com",
  "api.webmailagent.com",
  "agents.navorina.ai",
  "mail-api.navorina.ai",
]);

/** API → Hono; everything else → public/ static; www → apex; http → https */
async function handleFetch(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);

  if (isInsecureRequest(request) && HTTPS_HOSTS.has(url.hostname)) {
    const host =
      url.hostname === "www.webmailagent.com" ? "webmailagent.com" : url.hostname;
    return Response.redirect(
      `https://${host}${url.pathname}${url.search}`,
      301
    );
  }

  if (url.hostname === "www.webmailagent.com") {
    return Response.redirect(
      `https://webmailagent.com${url.pathname}${url.search}`,
      301
    );
  }

  const path = url.pathname;
  if (isApiPath(path)) {
    return app.fetch(request, env, ctx);
  }

  return withSecurityHeaders(await env.ASSETS.fetch(request), path);
}

export default {
  fetch: handleFetch,

  async queue(
    batch: MessageBatch<EmailQueueMessage>,
    env: Env
  ): Promise<void> {
    await handleQueueBatch(batch, env);
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const result = await purgeExpired(env);
    const audit = await purgeExpiredAuditEvents(env);
    const monitors = await runDueWorkspaceMonitors(env, 10);
    console.log("cron purge", { ...result, auditDeleted: audit.deleted, monitorsRan: monitors.ran });
  },
};

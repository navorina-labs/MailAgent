/** Hosted SaaS console API */
import { Hono } from "hono";
import type { Env } from "../env";
import type { ApiVariables } from "../lib/api-context";
import { requireApiKey } from "../lib/auth";
import { rateLimit } from "../lib/rate-limit";
import { buildConsoleSummary } from "../services/console-summary";
import { listRecentThreadsForScope } from "../services/console-threads";
import { auditRetentionDays } from "../services/audit-log";
import { buildConsoleInboxDetail } from "../services/console-inbox";
import { publicOriginFromUrl } from "../lib/public-origin";
import { getInbox } from "../services/inbox";
import { scopeInboxDenied } from "../lib/scope-guard";

export const consoleRoutes = new Hono<{ Bindings: Env; Variables: ApiVariables }>();

consoleRoutes.use("*", requireApiKey);
consoleRoutes.use("*", rateLimit);

consoleRoutes.get("/summary", async (c) => {
  const summary = await buildConsoleSummary(c.env, {
    apiKeyHint: c.get("apiKeyHint"),
    teamId: c.get("teamId"),
    apiKeyId: c.get("apiKeyId"),
    plan: c.get("apiPlan"),
    scope: c.get("apiKeyScope"),
  });
  return c.json(summary);
});

consoleRoutes.get("/threads", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 15), 50);
  const threads = await listRecentThreadsForScope(
    c.env,
    { teamId: c.get("teamId"), apiKeyHint: c.get("apiKeyHint") },
    { limit }
  );
  return c.json({
    threads,
    count: threads.length,
    policies: { auditRetentionDays: auditRetentionDays(c.env) },
  });
});

consoleRoutes.get("/inboxes/:id", async (c) => {
  const inboxId = c.req.param("id");
  const inbox = await getInbox(c.env, inboxId, {
    apiKeyHint: c.get("apiKeyHint"),
  });
  if (!inbox) return c.json({ error: "inbox_not_found" }, 404);
  const denied = scopeInboxDenied(c, inbox);
  if (denied) return denied;

  const detail = await buildConsoleInboxDetail(c.env, inboxId, {
    apiKeyHint: c.get("apiKeyHint"),
    apiBaseUrl: publicOriginFromUrl(c.req.url, c.env.MAILAGENT_PUBLIC_API_ORIGIN),
    teamId: c.get("teamId"),
    plan: c.get("apiPlan"),
  });
  if (!detail) return c.json({ error: "inbox_not_found" }, 404);
  return c.json(detail);
});

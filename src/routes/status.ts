/** Public status — no auth (uptime / DB probe). */
import { Hono } from "hono";
import type { Env } from "../env";
import { getDb } from "../db/client";
import { MCP_SERVER_INFO } from "../mcp/manifest";
import { workspaceUrl } from "../lib/public-origin";

export const statusRoutes = new Hono<{ Bindings: Env }>();

statusRoutes.get("/status", async (c) => {
  const checkedAt = new Date().toISOString();
  try {
    const sql = getDb(c.env);
    await sql`SELECT 1`;
    return c.json({
      status: "ok",
      db: true,
      version: MCP_SERVER_INFO.version,
      service: "mailagent",
      checkedAt,
      docs: workspaceUrl("/docs/agents.html", c.env.MAILAGENT_WORKSPACE_ORIGIN),
      health: "/health",
    });
  } catch (e) {
    return c.json(
      {
        status: "degraded",
        db: false,
        version: MCP_SERVER_INFO.version,
        service: "mailagent",
        checkedAt,
        error: e instanceof Error ? e.message : String(e),
      },
      503
    );
  }
});

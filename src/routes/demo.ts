/** Keyless demo for the landing page and /term. Nothing is stored; limited per IP. */
import { Hono } from "hono";
import type { Env } from "../env";
import { hourlyLimitHit } from "../lib/hourly-limit";
import { buildDemoRun, DEMO_SCENARIOS, resolveDemoScenario } from "../lib/demo";

export const demoRoutes = new Hono<{ Bindings: Env }>();

const PER_IP_PER_HOUR = 30;

demoRoutes.post("/", async (c) => {
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  if (await hourlyLimitHit(c.env.RATE_LIMIT, c.executionCtx, `demo:${ip}`, PER_IP_PER_HOUR)) {
    return c.json({ error: "rate_limit_exceeded", retryAfterSeconds: 3600 }, 429);
  }
  let body: { scenario?: unknown } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const scenario = resolveDemoScenario(body.scenario);
  if (!scenario) return c.json({ error: "unknown_scenario", scenarios: DEMO_SCENARIOS }, 400);
  return c.json(buildDemoRun(scenario, { inboxDomain: c.env.INBOX_DOMAIN }));
});

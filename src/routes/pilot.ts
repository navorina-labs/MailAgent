/** Public pilot request from the landing form. No API key; emailed to the team via Resend. */
import { Hono } from "hono";
import type { Env } from "../env";
import { createResendClient } from "../services/resend-mail";
import { pilotEmail, validatePilotRequest } from "../lib/pilot-request";

export const pilotRoutes = new Hono<{ Bindings: Env }>();

const DEFAULT_PILOT_INBOX = "hello@webmailagent.com";
const PER_IP_PER_HOUR = 5;

pilotRoutes.post("/", async (c) => {
  const kv = c.env.RATE_LIMIT;
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const key = `pilot:${ip}:${Math.floor(Date.now() / 3_600_000)}`;
  if (kv) {
    const used = Number((await kv.get(key)) ?? 0);
    if (used >= PER_IP_PER_HOUR) {
      return c.json({ error: "rate_limit_exceeded", retryAfterSeconds: 3600 }, 429);
    }
    c.executionCtx.waitUntil(kv.put(key, String(used + 1), { expirationTtl: 3700 }));
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  const result = validatePilotRequest(body);
  if (!result.ok) return c.json({ error: result.error, field: result.field }, 400);
  // Bots get the same answer as people, so the honeypot stays invisible.
  if (result.spam) return c.json({ status: "received" }, 202);

  const from = c.env.OUTBOUND_FROM?.trim();
  if (!from || !c.env.RESEND_API_KEY) {
    return c.json({ error: "pilot_unavailable", contact: DEFAULT_PILOT_INBOX }, 503);
  }

  const { subject, text } = pilotEmail(result.value);
  const { error } = await createResendClient(c.env).emails.send({
    from,
    to: [c.env.PILOT_INBOX?.trim() || DEFAULT_PILOT_INBOX],
    replyTo: result.value.email,
    subject,
    text,
  });
  if (error) {
    console.error("pilot_request_send_failed", error.message);
    return c.json({ error: "pilot_send_failed", contact: DEFAULT_PILOT_INBOX }, 502);
  }

  return c.json({ status: "received" }, 202);
});

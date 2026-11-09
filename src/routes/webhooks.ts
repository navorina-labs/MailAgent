import { Hono } from "hono";
import { Resend } from "resend";
import type { Env, EmailQueueMessage } from "../env";

export const webhookRoutes = new Hono<{ Bindings: Env }>();

/** Resend webhook: verify → enqueue → fast 200 */
webhookRoutes.post("/resend", async (c) => {
  const payload = await c.req.text();
  const resend = new Resend(c.env.RESEND_API_KEY);

  let event: { type: string; data: unknown };
  try {
    event = resend.webhooks.verify({
      payload,
      headers: {
        id: c.req.header("svix-id") ?? "",
        timestamp: c.req.header("svix-timestamp") ?? "",
        signature: c.req.header("svix-signature") ?? "",
      },
      webhookSecret: c.env.RESEND_WEBHOOK_SECRET,
    }) as { type: string; data: unknown };
  } catch {
    return c.json({ error: "invalid_signature" }, 401);
  }

  if (event.type !== "email.received") {
    return c.json({ ok: true, skipped: event.type });
  }

  const data = event.data as {
    email_id: string;
    from: string;
    to: string[];
    subject?: string;
  };

  const job: EmailQueueMessage = {
    provider: "resend",
    emailId: data.email_id,
    from: data.from,
    to: data.to ?? [],
    subject: data.subject ?? "",
    receivedAt: new Date().toISOString(),
  };

  await c.env.MAIL_QUEUE.send(job);
  return c.json({ ok: true, queued: true });
});

/** Enterprise: per-team Resend webhook (isolated inbound) */
webhookRoutes.post("/resend/team/:teamId", async (c) => {
  const teamId = c.req.param("teamId");
  const { getTeamWebhookSecret } = await import("../services/team-resend");
  const webhookSecret = await getTeamWebhookSecret(c.env, teamId);
  if (!webhookSecret) {
    return c.json({ error: "dedicated_resend_not_configured" }, 404);
  }

  const payload = await c.req.text();
  const { getTeamResendApiKey } = await import("../services/team-resend");
  const apiKey = await getTeamResendApiKey(c.env, teamId);
  if (!apiKey) {
    return c.json({ error: "dedicated_resend_not_configured" }, 404);
  }

  const resend = new Resend(apiKey);
  let event: { type: string; data: unknown };
  try {
    event = resend.webhooks.verify({
      payload,
      headers: {
        id: c.req.header("svix-id") ?? "",
        timestamp: c.req.header("svix-timestamp") ?? "",
        signature: c.req.header("svix-signature") ?? "",
      },
      webhookSecret,
    }) as { type: string; data: unknown };
  } catch {
    return c.json({ error: "invalid_signature" }, 401);
  }

  if (event.type !== "email.received") {
    return c.json({ ok: true, skipped: event.type });
  }

  const data = event.data as {
    email_id: string;
    from: string;
    to: string[];
    subject?: string;
  };

  const job: EmailQueueMessage = {
    provider: "resend",
    emailId: data.email_id,
    from: data.from,
    to: data.to ?? [],
    subject: data.subject ?? "",
    receivedAt: new Date().toISOString(),
    resendTeamId: teamId,
  };

  await c.env.MAIL_QUEUE.send(job);
  return c.json({ ok: true, queued: true, teamId });
});

/** Stripe: subscription lifecycle → teams.plan */
webhookRoutes.post("/stripe", async (c) => {
  if (!c.env.STRIPE_WEBHOOK_SECRET?.trim()) {
    return c.json({ error: "stripe_not_configured" }, 503);
  }
  const payload = await c.req.text();
  try {
    const { handleStripeWebhook } = await import("../services/billing");
    const { duplicate } = await handleStripeWebhook(c.env, payload, c.req.header("stripe-signature"));
    return c.json({ received: true, duplicate });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "webhook_error";
    if (msg === "invalid_stripe_signature") {
      return c.json({ error: msg }, 400);
    }
    // 500 makes Stripe retry the delivery later.
    console.warn("stripe webhook", msg);
    return c.json({ error: "webhook_failed" }, 500);
  }
});

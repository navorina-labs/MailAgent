/**
 * Self-serve Free API keys (no API key needed).
 * POST /v1/keys/request  { email }  → emails a one-time confirmation link
 * POST /v1/keys/confirm  { token }  → returns a new Free key once
 * POST /v1/keys/rotate/request { email } → emails a one-time link to replace the key
 * POST /v1/keys/rotate/confirm { token } → revokes all keys for that email, returns a new one
 * The key is shown on the confirmation page only; it is never emailed.
 */
import { Hono } from "hono";
import type { Env } from "../env";
import { createResendClient } from "../services/resend-mail";
import { checkEmailAddress } from "../services/email-check";
import { addTeamKey, countTeamKeys, registerApiKey, rotateTeamKeys } from "../services/api-key-store";
import { PLAN_LIMITS } from "../lib/plans";
import { workspaceUrl } from "../lib/public-origin";
import { hourlyLimitHit } from "../lib/hourly-limit";
import {
  SIGNUP_TOKEN_TTL_SECONDS,
  confirmationEmail,
  isOwnInboxDomain,
  newApiKey,
  newSignupToken,
  noKeyEmail,
  normalizeSignupEmail,
  rotationEmail,
  sha256Hex,
} from "../lib/key-signup";

export const keySignupRoutes = new Hono<{ Bindings: Env }>();

const CONTACT = "hello@webmailagent.com";
const tokenKey = (hash: string) => `keysignup:tok:${hash}`;
const emailKey = (hash: string) => `keysignup:email:${hash}`;
const rotateTokenKey = (hash: string) => `keyrotate:tok:${hash}`;

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

keySignupRoutes.post("/request", async (c) => {
  const kv = c.env.RATE_LIMIT;
  if (!kv) return c.json({ error: "signup_unavailable", contact: CONTACT }, 503);

  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  if (await hourlyLimitHit(kv, c.executionCtx, `keysignup:ip:${ip}`, 5)) {
    return c.json({ error: "rate_limit_exceeded", retryAfterSeconds: 3600 }, 429);
  }

  const body = await readJson(c.req.raw);
  if (!body) return c.json({ error: "invalid_json" }, 400);
  // Honeypot: bots get the same answer as people.
  if (typeof body.website === "string" && body.website.trim()) return c.json({ status: "sent" }, 202);

  const email = normalizeSignupEmail(body.email);
  if (!email) return c.json({ error: "invalid_email", field: "email" }, 400);
  if (isOwnInboxDomain(email, c.env.INBOX_DOMAIN)) {
    return c.json({ error: "inbox_domain_not_allowed", field: "email" }, 400);
  }

  const check = await checkEmailAddress(c.env, { email });
  if ("error" in check) return c.json({ error: "invalid_email", field: "email" }, 400);
  if (check.misc.isDisposable) return c.json({ error: "disposable_email", field: "email" }, 400);
  if (check.mx.acceptsMail === false) return c.json({ error: "email_not_deliverable", field: "email" }, 400);

  const emailHash = await sha256Hex(email);
  if (await hourlyLimitHit(kv, c.executionCtx, `keysignup:em:${emailHash}`, 3)) {
    return c.json({ error: "rate_limit_exceeded", retryAfterSeconds: 3600 }, 429);
  }

  const from = c.env.OUTBOUND_FROM?.trim();
  if (!from || !c.env.RESEND_API_KEY) return c.json({ error: "signup_unavailable", contact: CONTACT }, 503);

  const token = newSignupToken();
  await kv.put(tokenKey(await sha256Hex(token)), JSON.stringify({ email, createdAt: Date.now() }), {
    expirationTtl: SIGNUP_TOKEN_TTL_SECONDS,
  });

  // Token in the fragment: it never reaches server logs or Referer headers.
  const link = `${workspaceUrl("/get-key.html", c.env.MAILAGENT_WORKSPACE_ORIGIN)}#t=${token}`;
  const { subject, text } = confirmationEmail(link);
  const { error } = await createResendClient(c.env).emails.send({ from, to: [email], subject, text });
  if (error) {
    console.error("key_signup_send_failed", error.message);
    return c.json({ error: "send_failed", contact: CONTACT }, 502);
  }

  return c.json({ status: "sent" }, 202);
});

keySignupRoutes.post("/confirm", async (c) => {
  const kv = c.env.RATE_LIMIT;
  if (!kv) return c.json({ error: "signup_unavailable", contact: CONTACT }, 503);

  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  if (await hourlyLimitHit(kv, c.executionCtx, `keysignup:confirm:${ip}`, 20)) {
    return c.json({ error: "rate_limit_exceeded", retryAfterSeconds: 3600 }, 429);
  }

  const body = await readJson(c.req.raw);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token || token.length > 128) return c.json({ error: "invalid_or_expired_token" }, 400);

  const key = tokenKey(await sha256Hex(token));
  const raw = await kv.get(key);
  if (!raw) return c.json({ error: "invalid_or_expired_token" }, 400);
  await kv.delete(key); // one-time

  const { email } = JSON.parse(raw) as { email: string };
  const emailHash = await sha256Hex(email);
  const apiKey = newApiKey();
  const limits = PLAN_LIMITS.free;

  const existingTeam = await kv.get(emailKey(emailHash));
  let teamId: string;
  if (existingTeam) {
    if ((await countTeamKeys(c.env, existingTeam)) >= limits.maxTeamKeys) {
      return c.json({ error: "key_limit_reached", contact: CONTACT }, 409);
    }
    await addTeamKey(c.env, existingTeam, { token: apiKey, label: "self-serve" });
    teamId = existingTeam;
  } else {
    // Team name holds the email so the operator can find the team (Pro upgrades, support).
    ({ teamId } = await registerApiKey(c.env, { token: apiKey, teamName: email, label: "self-serve", plan: "free" }));
    await kv.put(emailKey(emailHash), teamId);
  }

  return c.json(
    {
      apiKey,
      teamId,
      plan: "free",
      limits: {
        activeInboxes: limits.maxActiveInboxes,
        requestsPerMinute: limits.rateLimitPerMinute,
        emailsPerMonth: limits.monthlyEmails,
      },
      docs: workspaceUrl("/docs/agents.html", c.env.MAILAGENT_WORKSPACE_ORIGIN),
    },
    201
  );
});

keySignupRoutes.post("/rotate/request", async (c) => {
  const kv = c.env.RATE_LIMIT;
  const from = c.env.OUTBOUND_FROM?.trim();
  if (!kv || !from || !c.env.RESEND_API_KEY) return c.json({ error: "signup_unavailable", contact: CONTACT }, 503);

  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  if (await hourlyLimitHit(kv, c.executionCtx, `keyrotate:ip:${ip}`, 5)) {
    return c.json({ error: "rate_limit_exceeded", retryAfterSeconds: 3600 }, 429);
  }

  const body = await readJson(c.req.raw);
  if (!body) return c.json({ error: "invalid_json" }, 400);
  if (typeof body.website === "string" && body.website.trim()) return c.json({ status: "sent" }, 202);

  const email = normalizeSignupEmail(body.email);
  if (!email) return c.json({ error: "invalid_email", field: "email" }, 400);

  const emailHash = await sha256Hex(email);
  if (await hourlyLimitHit(kv, c.executionCtx, `keyrotate:em:${emailHash}`, 3)) {
    return c.json({ error: "rate_limit_exceeded", retryAfterSeconds: 3600 }, 429);
  }

  // Same answer whether or not the email has a key: no account enumeration.
  const teamId = await kv.get(emailKey(emailHash));
  let mail: { subject: string; text: string };
  if (teamId) {
    const token = newSignupToken();
    await kv.put(rotateTokenKey(await sha256Hex(token)), JSON.stringify({ email, teamId }), {
      expirationTtl: SIGNUP_TOKEN_TTL_SECONDS,
    });
    mail = rotationEmail(`${workspaceUrl("/get-key.html", c.env.MAILAGENT_WORKSPACE_ORIGIN)}#r=${token}`);
  } else {
    mail = noKeyEmail(workspaceUrl("/get-key.html", c.env.MAILAGENT_WORKSPACE_ORIGIN));
  }

  const { error } = await createResendClient(c.env).emails.send({ from, to: [email], ...mail });
  if (error) {
    console.error("key_rotate_send_failed", error.message);
    return c.json({ error: "send_failed", contact: CONTACT }, 502);
  }
  return c.json({ status: "sent" }, 202);
});

keySignupRoutes.post("/rotate/confirm", async (c) => {
  const kv = c.env.RATE_LIMIT;
  if (!kv) return c.json({ error: "signup_unavailable", contact: CONTACT }, 503);

  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  if (await hourlyLimitHit(kv, c.executionCtx, `keyrotate:confirm:${ip}`, 20)) {
    return c.json({ error: "rate_limit_exceeded", retryAfterSeconds: 3600 }, 429);
  }

  const body = await readJson(c.req.raw);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token || token.length > 128) return c.json({ error: "invalid_or_expired_token" }, 400);

  const key = rotateTokenKey(await sha256Hex(token));
  const raw = await kv.get(key);
  if (!raw) return c.json({ error: "invalid_or_expired_token" }, 400);
  await kv.delete(key); // one-time

  const { teamId } = JSON.parse(raw) as { email: string; teamId: string };
  const apiKey = newApiKey();
  const { revoked, movedInboxes } = await rotateTeamKeys(c.env, teamId, { token: apiKey, label: "self-serve" });

  return c.json(
    {
      apiKey,
      teamId,
      revokedKeys: revoked,
      movedInboxes,
      docs: workspaceUrl("/docs/agents.html", c.env.MAILAGENT_WORKSPACE_ORIGIN),
    },
    201
  );
});

import type { Context, Next } from "hono";
import type { Env } from "../env";
import type { ApiVariables } from "./api-context";
import { bearerToken } from "./api-key-hint";
import { PLAN_LIMITS } from "./plans";
import { resolveAuth } from "../services/api-key-store";
import { unauthorizedBody } from "./auth-error";
import { SUSPENDED_MESSAGE } from "./abuse";
import type { ResolvedAuth } from "../services/api-key-store";

function applyAuthContext(
  c: Context<{ Bindings: Env; Variables: ApiVariables }>,
  auth: ResolvedAuth
) {
  const limits = PLAN_LIMITS[auth.plan];
  c.set("apiKeyHint", auth.hint);
  c.set("apiPlan", auth.plan);
  c.set("rateLimitPerMinute", limits.rateLimitPerMinute);
  c.set("maxActiveInboxes", limits.maxActiveInboxes);
  c.set("teamId", auth.teamId);
  c.set("apiKeyId", auth.apiKeyId);
  c.set("apiKeyScope", auth.scope);
}

/** Bearer: API key or OAuth mat_ access token */
export async function requireApiKey(
  c: Context<{ Bindings: Env; Variables: ApiVariables }>,
  next: Next
) {
  const token = bearerToken(c.req.header("Authorization"));
  const auth = await resolveAuth(c.env, token);
  if (!auth) {
    return c.json(unauthorizedBody(Boolean(token)), 401);
  }
  if (auth.suspended) return c.json({ error: "account_suspended", message: SUSPENDED_MESSAGE }, 403);
  applyAuthContext(c, auth);
  await next();
}

/** MCP: 401 with WWW-Authenticate → OAuth discovery (RFC 9728) */
export async function requireMcpAuth(
  c: Context<{ Bindings: Env; Variables: ApiVariables }>,
  next: Next
) {
  const token = bearerToken(c.req.header("Authorization"));
  const auth = await resolveAuth(c.env, token);
  if (!auth) {
    const origin = publicOriginFromUrl(c.req.url, c.env.MAILAGENT_PUBLIC_API_ORIGIN);
    c.header(
      "WWW-Authenticate",
      `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`
    );
    return c.json(
      { ...unauthorizedBody(Boolean(token)), oauth: `${origin}/.well-known/oauth-authorization-server` },
      401
    );
  }
  if (auth.suspended) return c.json({ error: "account_suspended", message: SUSPENDED_MESSAGE }, 403);
  applyAuthContext(c, auth);
  await next();
}

import { publicOriginFromUrl } from "../lib/public-origin";
import { isOidcEnabled } from "../services/oidc-oauth";

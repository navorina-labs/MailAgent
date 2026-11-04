/** OAuth 2.0 token + RFC 8414 / 9728 / 7591 + OIDC IdP (authorization_code) */
import { Hono } from "hono";
import type { Env } from "../env";
import type { ApiVariables } from "../lib/api-context";
import { publicOriginFromUrl, workspaceUrl } from "../lib/public-origin";
import { requireApiKey } from "../lib/auth";
import { rateLimit } from "../lib/rate-limit";
import { generateApiKeyToken } from "../lib/generate-api-key";
import { narrowScope, parseScopeBody } from "../lib/key-scope";
import { scopeAdminDenied } from "../lib/scope-guard";
import { addTeamKey, listTeamKeys, resolveAuth } from "../services/api-key-store";
import { issueMcpAccessToken } from "../services/mcp-oauth";
import {
  exchangeAuthorizationCode,
  finishOidcCallback,
  isOidcEnabled,
  startOidcAuthorize,
} from "../services/oidc-oauth";

function publicOrigin(c: { req: { url: string }; env: Env }): string {
  return publicOriginFromUrl(c.req.url, c.env.MAILAGENT_PUBLIC_API_ORIGIN);
}

function authorizationServerMetadata(origin: string, env: Env) {
  const oidc = isOidcEnabled(env);
  return {
    issuer: origin,
    token_endpoint: `${origin}/v1/oauth/token`,
    registration_endpoint: `${origin}/v1/oauth/register`,
    ...(oidc
      ? {
          authorization_endpoint: `${origin}/v1/oauth/authorize`,
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
        }
      : {}),
    grant_types_supported: oidc
      ? ["client_credentials", "authorization_code"]
      : ["client_credentials"],
    token_endpoint_auth_methods_supported: [
      "client_secret_post",
      "client_secret_basic",
      "none",
    ],
    scopes_supported: ["mcp:tools", "openid", "profile", "email"],
  };
}

export const wellKnownRoutes = new Hono<{ Bindings: Env }>();

wellKnownRoutes.get("/.well-known/oauth-authorization-server", (c) => {
  const origin = publicOrigin(c);
  return c.json(authorizationServerMetadata(origin, c.env));
});

wellKnownRoutes.get("/.well-known/oauth-protected-resource/mcp", (c) => {
  const origin = publicOrigin(c);
  return c.json({
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp:tools"],
    resource_documentation: workspaceUrl(
      "/docs/agents.html#mcp-oauth",
      c.env.MAILAGENT_WORKSPACE_ORIGIN
    ),
  });
});

wellKnownRoutes.get("/.well-known/oauth-protected-resource", (c) => {
  const origin = publicOrigin(c);
  const resource = c.req.query("resource") ?? `${origin}/mcp`;
  return c.json({
    resource,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp:tools"],
  });
});

export const oauthTokenRoutes = new Hono<{ Bindings: Env; Variables: ApiVariables }>();

/** OIDC login start (MCP authorization_code + PKCE) */
oauthTokenRoutes.get("/authorize", async (c) => {
  if (!isOidcEnabled(c.env)) {
    return c.json(
      {
        error: "oidc_not_configured",
        hint: "Set OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET on Worker",
        docs: workspaceUrl("/docs/MCP-OAUTH-IDP.html", c.env.MAILAGENT_WORKSPACE_ORIGIN),
      },
      501
    );
  }

  const redirectUri = c.req.query("redirect_uri")?.trim();
  const state = c.req.query("state")?.trim();
  const codeChallenge = c.req.query("code_challenge")?.trim();
  const responseType = c.req.query("response_type")?.trim() ?? "code";

  if (!redirectUri || !state || !codeChallenge) {
    return c.json({ error: "invalid_request", error_description: "redirect_uri, state, code_challenge required" }, 400);
  }
  if (responseType !== "code") {
    return c.json({ error: "unsupported_response_type" }, 400);
  }

  try {
    const url = await startOidcAuthorize(c.env, publicOrigin(c), {
      redirectUri,
      state,
      codeChallenge,
      codeChallengeMethod: c.req.query("code_challenge_method") ?? "S256",
    });
    return c.redirect(url, 302);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "authorize_failed";
    return c.json({ error: "server_error", error_description: msg }, 500);
  }
});

/** IdP redirect back → issue MailAgent auth code to MCP client */
oauthTokenRoutes.get("/callback", async (c) => {
  if (!isOidcEnabled(c.env)) {
    return c.json({ error: "oidc_not_configured" }, 501);
  }

  const err = c.req.query("error");
  if (err) {
    return c.json({ error: err, error_description: c.req.query("error_description") ?? undefined }, 400);
  }

  const idpCode = c.req.query("code")?.trim();
  const internalState = c.req.query("state")?.trim();
  if (!idpCode || !internalState) {
    return c.json({ error: "invalid_request" }, 400);
  }

  try {
    const { redirectUrl } = await finishOidcCallback(c.env, publicOrigin(c), idpCode, internalState);
    return c.redirect(redirectUrl, 302);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "callback_failed";
    return c.json({ error: "server_error", error_description: msg }, 500);
  }
});

/** RFC 7591 Dynamic Client Registration — new MCP client key for team */
oauthTokenRoutes.post("/register", requireApiKey, rateLimit, async (c) => {
  const adminErr = scopeAdminDenied(c);
  if (adminErr) return adminErr;

  const teamId = c.get("teamId");
  if (!teamId) {
    return c.json(
      {
        error: "team_required",
        hint: "DCR requires DB team key (npm run issue:key:db)",
      },
      403
    );
  }

  let body: {
    client_name?: string;
    redirect_uris?: string[];
    grant_types?: string[];
    token_endpoint_auth_method?: string;
    scope?: { labelPrefix?: string; readOnly?: boolean };
    labelPrefix?: string;
    readOnly?: boolean;
  } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const scopeInput = parseScopeBody(body);
  const narrowed = narrowScope(c.get("apiKeyScope"), scopeInput);
  if ("error" in narrowed) {
    return c.json({ error: narrowed.error, hint: narrowed.hint }, 400);
  }

  const clientName = (body.client_name ?? "mcp-client").trim().slice(0, 64) || "mcp-client";
  const token = generateApiKeyToken();
  const { apiKeyId, hint } = await addTeamKey(c.env, teamId, {
    token,
    label: `mcp:${clientName}`.slice(0, 64),
    scope: narrowed.scope,
  });

  const origin = publicOrigin(c);
  const issuedAt = Math.floor(Date.now() / 1000);
  const defaultGrants = isOidcEnabled(c.env)
    ? ["client_credentials", "authorization_code"]
    : ["client_credentials"];

  return c.json(
    {
      client_id: `mac_${apiKeyId}`,
      client_secret: token,
      client_id_issued_at: issuedAt,
      client_secret_expires_at: 0,
      client_name: clientName,
      grant_types: body.grant_types ?? defaultGrants,
      token_endpoint_auth_method: body.token_endpoint_auth_method ?? "client_secret_post",
      redirect_uris: body.redirect_uris ?? [],
      token_endpoint: `${origin}/v1/oauth/token`,
      registration_client_uri: `${origin}/v1/oauth/clients/${apiKeyId}`,
      key_hint: hint,
      scopes: ["mcp:tools"],
      scope: narrowed.scope,
      warning: "Store client_secret now; it will not be shown again.",
    },
    201
  );
});

/** GET /v1/oauth/clients/:id — metadata without secret (Bearer team key) */
oauthTokenRoutes.get("/clients/:id", requireApiKey, rateLimit, async (c) => {
  const teamId = c.get("teamId");
  if (!teamId) {
    return c.json({ error: "team_required" }, 403);
  }
  const apiKeyId = c.req.param("id");
  const keys = await listTeamKeys(c.env, teamId);
  const key = keys.find((k) => k.id === apiKeyId);
  if (!key) return c.json({ error: "client_not_found" }, 404);

  const origin = publicOrigin(c);
  return c.json({
    client_id: `mac_${key.id}`,
    client_name: key.label?.replace(/^mcp:/, "") ?? key.label,
    key_hint: key.key_hint,
    created_at: key.created_at,
    scope: {
      labelPrefix: key.scope_label_prefix,
      readOnly: key.scope_read_only,
    },
    token_endpoint: `${origin}/v1/oauth/token`,
  });
});

/** POST /v1/oauth/token — client_credentials | authorization_code */
oauthTokenRoutes.post("/token", async (c) => {
  const params = await readTokenParams(c);

  if (params.grantType === "authorization_code") {
    if (!params.code || !params.redirectUri || !params.codeVerifier) {
      return c.json(
        { error: "invalid_request", error_description: "code, redirect_uri, code_verifier required" },
        400
      );
    }
    const token = await exchangeAuthorizationCode(c.env, {
      code: params.code,
      redirectUri: params.redirectUri,
      codeVerifier: params.codeVerifier,
    });
    if (!token) {
      return c.json({ error: "invalid_grant" }, 400);
    }
    return c.json(token);
  }

  if (params.grantType !== "client_credentials") {
    return c.json(
      {
        error: "unsupported_grant_type",
        error_description: "Use client_credentials or authorization_code",
      },
      400
    );
  }

  if (!params.clientSecret) {
    return c.json(
      { error: "invalid_client", error_description: "client_secret (API key) required" },
      401
    );
  }

  const auth = await resolveAuth(c.env, params.clientSecret);
  if (!auth) {
    return c.json({ error: "invalid_client" }, 401);
  }

  const token = await issueMcpAccessToken(c.env, auth);
  if (!token) {
    return c.json(
      {
        error: "server_error",
        error_description: "OAuth token issuance unavailable (check API_KEY or MCP_OAUTH_JWT_SECRET)",
      },
      503
    );
  }

  return c.json(token);
});

async function readTokenParams(c: {
  req: {
    header: (name: string) => string | undefined;
    json: () => Promise<unknown>;
    text: () => Promise<string>;
  };
}) {
  const contentType = c.req.header("Content-Type") ?? "";
  let grantType = "";
  let clientSecret = "";
  let code = "";
  let redirectUri = "";
  let codeVerifier = "";

  if (contentType.includes("application/json")) {
    let body: Record<string, string> = {};
    try {
      body = (await c.req.json()) as Record<string, string>;
    } catch {
      return { grantType, clientSecret, code, redirectUri, codeVerifier };
    }
    grantType = body.grant_type ?? "";
    clientSecret = body.client_secret ?? "";
    code = body.code ?? "";
    redirectUri = body.redirect_uri ?? "";
    codeVerifier = body.code_verifier ?? "";
  } else {
    const raw = await c.req.text();
    const params = new URLSearchParams(raw);
    grantType = params.get("grant_type") ?? "";
    clientSecret = params.get("client_secret") ?? "";
    code = params.get("code") ?? "";
    redirectUri = params.get("redirect_uri") ?? "";
    codeVerifier = params.get("code_verifier") ?? "";
  }

  const basic = parseBasicAuth(c.req.header("Authorization"));
  if (basic?.password && !clientSecret) {
    clientSecret = basic.password;
  }

  return { grantType, clientSecret, code, redirectUri, codeVerifier };
}

function parseBasicAuth(header: string | undefined): { user: string; password: string } | null {
  if (!header?.startsWith("Basic ")) return null;
  try {
    const decoded = atob(header.slice(6).trim());
    const i = decoded.indexOf(":");
    if (i < 0) return { user: decoded, password: "" };
    return { user: decoded.slice(0, i), password: decoded.slice(i + 1) };
  } catch {
    return null;
  }
}

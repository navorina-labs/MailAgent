/** Team admin: team keys (invite = issue a new key) */
import { Hono } from "hono";
import type { Env } from "../env";
import type { ApiVariables } from "../lib/api-context";
import { requireApiKey } from "../lib/auth";
import { narrowScope, parseScopeBody } from "../lib/key-scope";
import { scopeAdminDenied } from "../lib/scope-guard";
import { rateLimit } from "../lib/rate-limit";
import { generateApiKeyToken } from "../lib/generate-api-key";
import { PLAN_LIMITS } from "../lib/plans";
import {
  addTeamKey,
  countTeamKeys,
  getTeam,
  listTeamKeys,
  revokeTeamKey,
} from "../services/api-key-store";
import { countActiveInboxesForTeam } from "../services/inbox";
import { auditRoute } from "../services/audit-log";
import {
  clearTeamDedicatedResend,
  getDedicatedResendStatus,
  isEnterprisePlan,
  setTeamDedicatedResend,
} from "../services/team-resend";
import {
  clearTeamEventWebhook,
  getTeamEventWebhook,
  setTeamEventWebhook,
} from "../services/team-event-webhook";

export const teamRoutes = new Hono<{ Bindings: Env; Variables: ApiVariables }>();

teamRoutes.use("*", requireApiKey);
teamRoutes.use("*", rateLimit);

function requireTeam(c: { get: (k: "teamId") => string | null }) {
  const teamId = c.get("teamId");
  if (!teamId) return null;
  return teamId;
}

teamRoutes.get("/", async (c) => {
  const teamId = requireTeam(c);
  if (!teamId) {
    return c.json(
      {
        error: "team_required",
        hint: "Use a DB-registered key: npm run issue:key:db",
      },
      403
    );
  }

  const team = await getTeam(c.env, teamId);
  if (!team) return c.json({ error: "team_not_found" }, 404);

  const keys = await listTeamKeys(c.env, teamId);
  const plan = c.get("apiPlan");
  const limits = PLAN_LIMITS[plan];
  const activeInboxes = await countActiveInboxesForTeam(c.env, teamId);
  const dedicatedResend = await getDedicatedResendStatus(c.env, teamId);

  return c.json({
    id: team.id,
    name: team.name,
    plan: team.plan,
    createdAt: team.created_at,
    limits: {
      maxTeamKeys: limits.maxTeamKeys,
      maxActiveInboxes: limits.maxActiveInboxes,
      maxCustomDomains: limits.maxCustomDomains,
      notifyEmailsPerDay: limits.notifyEmailsPerDay,
      dedicatedResend: limits.dedicatedResend,
    },
    dedicatedResend,
    usage: {
      keys: keys.length,
      activeInboxes,
    },
    keys: keys.map((k) => ({
      id: k.id,
      hint: k.key_hint,
      label: k.label,
      createdAt: k.created_at,
      expiresAt: k.expires_at,
      current: k.id === c.get("apiKeyId"),
      scope: {
        labelPrefix: k.scope_label_prefix,
        readOnly: k.scope_read_only,
      },
    })),
  });
});

teamRoutes.post("/keys", async (c) => {
  const adminErr = scopeAdminDenied(c);
  if (adminErr) return adminErr;

  const teamId = requireTeam(c);
  if (!teamId) {
    return c.json({ error: "team_required" }, 403);
  }

  const plan = c.get("apiPlan");
  const maxKeys = PLAN_LIMITS[plan].maxTeamKeys;
  if (maxKeys < 1) {
    return c.json({ error: "team_keys_not_supported_on_legacy" }, 400);
  }

  const count = await countTeamKeys(c.env, teamId);
  if (count >= maxKeys) {
    return c.json({ error: "team_key_limit_reached", max: maxKeys }, 429);
  }

  let body: {
    label?: string;
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

  const token = generateApiKeyToken();
  const { apiKeyId, hint } = await addTeamKey(c.env, teamId, {
    token,
    label: body.label?.trim().slice(0, 64),
    scope: narrowed.scope,
  });

  auditRoute(
    c,
    {
      action: "team.key.created",
      resourceType: "api_key",
      resourceId: apiKeyId,
      meta: { hint, label: body.label ?? null },
    }
  );

  return c.json(
    {
      id: apiKeyId,
      key: token,
      hint,
      label: body.label ?? null,
      scope: narrowed.scope,
      note: "Save the key now — it is shown only once.",
    },
    201
  );
});

teamRoutes.delete("/keys/:id", async (c) => {
  const adminErr = scopeAdminDenied(c);
  if (adminErr) return adminErr;

  const teamId = requireTeam(c);
  if (!teamId) return c.json({ error: "team_required" }, 403);

  const keyId = c.req.param("id");
  const ok = await revokeTeamKey(c.env, teamId, keyId);
  if (!ok) {
    return c.json(
      { error: "cannot_revoke", hint: "Last key or wrong id" },
      400
    );
  }
  auditRoute(c, {
      action: "team.key.revoked",
      resourceType: "api_key",
      resourceId: keyId,
    });
  return c.json({ revoked: true, id: keyId });
});

teamRoutes.get("/dedicated-resend", async (c) => {
  const teamId = requireTeam(c);
  if (!teamId) return c.json({ error: "team_required" }, 403);
  const status = await getDedicatedResendStatus(c.env, teamId);
  return c.json({
    ...status,
    plan: c.get("apiPlan"),
    enterpriseRequired: isEnterprisePlan(c.get("apiPlan")),
  });
});

teamRoutes.get("/webhooks", async (c) => {
  const teamId = requireTeam(c);
  if (!teamId) {
    return c.json({ error: "team_required" }, 403);
  }
  return c.json(await getTeamEventWebhook(c.env, teamId));
});

teamRoutes.put("/webhooks", async (c) => {
  const adminErr = scopeAdminDenied(c);
  if (adminErr) return adminErr;

  const teamId = requireTeam(c);
  if (!teamId) return c.json({ error: "team_required" }, 403);

  let body: { url?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  const url = body.url?.trim();
  if (!url) return c.json({ error: "url_required" }, 400);

  const result = await setTeamEventWebhook(c.env, teamId, url);
  if (!result.ok) {
    return c.json({ error: result.error }, 400);
  }

  auditRoute(c, {
    action: "team.webhook.configured",
    resourceType: "team",
    resourceId: teamId,
  });

  return c.json(await getTeamEventWebhook(c.env, teamId));
});

teamRoutes.post("/webhooks", async (c) => {
  const adminErr = scopeAdminDenied(c);
  if (adminErr) return adminErr;

  const teamId = requireTeam(c);
  if (!teamId) return c.json({ error: "team_required" }, 403);

  let body: { url?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  const url = body.url?.trim();
  if (!url) return c.json({ error: "url_required" }, 400);

  const result = await setTeamEventWebhook(c.env, teamId, url);
  if (!result.ok) {
    return c.json({ error: result.error }, 400);
  }

  auditRoute(c, {
    action: "team.webhook.configured",
    resourceType: "team",
    resourceId: teamId,
  });

  return c.json(await getTeamEventWebhook(c.env, teamId), 201);
});

teamRoutes.delete("/webhooks", async (c) => {
  const adminErr = scopeAdminDenied(c);
  if (adminErr) return adminErr;

  const teamId = requireTeam(c);
  if (!teamId) return c.json({ error: "team_required" }, 403);

  await clearTeamEventWebhook(c.env, teamId);
  auditRoute(c, {
    action: "team.webhook.cleared",
    resourceType: "team",
    resourceId: teamId,
  });

  return c.json({ ok: true });
});

teamRoutes.put("/dedicated-resend", async (c) => {
  const adminErr = scopeAdminDenied(c);
  if (adminErr) return adminErr;

  const teamId = requireTeam(c);
  if (!teamId) return c.json({ error: "team_required" }, 403);

  if (!isEnterprisePlan(c.get("apiPlan"))) {
    return c.json(
      {
        error: "enterprise_plan_required",
        hint: "Contact Navorina support or run npm run team:plan -- TEAM_ID enterprise",
      },
      403
    );
  }

  let body: { resendApiKey?: string; webhookSecret?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  const resendApiKey = body.resendApiKey?.trim();
  const webhookSecret = body.webhookSecret?.trim();
  if (!resendApiKey || !webhookSecret) {
    return c.json({ error: "resend_api_key_and_webhook_secret_required" }, 400);
  }

  const result = await setTeamDedicatedResend(c.env, teamId, {
    resendApiKey,
    webhookSecret,
  });
  if (!result.ok) {
    return c.json({ error: result.error }, 400);
  }

  auditRoute(c, {
    action: "team.dedicated_resend.configured",
    resourceType: "team",
    resourceId: teamId,
  });

  const status = await getDedicatedResendStatus(c.env, teamId);
  return c.json(status);
});

teamRoutes.delete("/dedicated-resend", async (c) => {
  const adminErr = scopeAdminDenied(c);
  if (adminErr) return adminErr;

  const teamId = requireTeam(c);
  if (!teamId) return c.json({ error: "team_required" }, 403);

  const ok = await clearTeamDedicatedResend(c.env, teamId);
  if (!ok) return c.json({ error: "team_not_found" }, 404);

  auditRoute(c, {
    action: "team.dedicated_resend.cleared",
    resourceType: "team",
    resourceId: teamId,
  });

  return c.json({ cleared: true });
});

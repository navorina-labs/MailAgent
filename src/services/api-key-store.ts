/** Keys and teams in Neon (Phase 3) */
import { nanoid } from "nanoid";
import type { Env } from "../env";
import { getDb } from "../db/client";
import { apiKeyHashFromToken, apiKeyHintFromToken } from "../lib/api-key-hint";
import { scopeFromDb } from "../lib/key-scope";
import { normalizePlan, type PlanId } from "../lib/plans";
import { allowedApiKeys } from "../lib/api-keys";

import type { ApiKeyScope } from "../lib/key-scope";
import { FULL_ACCESS_SCOPE } from "../lib/key-scope";

export interface ResolvedAuth {
  hint: string;
  plan: PlanId;
  teamId: string | null;
  apiKeyId: string | null;
  label: string | null;
  scope: ApiKeyScope;
}

export async function resolveAuth(
  env: Env,
  token: string | null
): Promise<ResolvedAuth | null> {
  if (!token) return null;

  if (token.startsWith("mat_")) {
    const { resolveMcpAccessToken } = await import("./mcp-oauth");
    const oauth = await resolveMcpAccessToken(env, token);
    if (oauth) return oauth;
    return null;
  }

  const hint = await apiKeyHintFromToken(token);
  const hash = await apiKeyHashFromToken(token);

  const row = await lookupKeyByHash(env, hash);
  if (row) {
    const plan = normalizePlan(row.team_plan);
    return {
      hint,
      plan,
      teamId: row.team_id,
      apiKeyId: row.id,
      label: row.label,
      scope: scopeFromDb(row),
    };
  }

  const envKeys = allowedApiKeys(env);
  if (envKeys.length > 0 && envKeys.includes(token)) {
    return {
      hint,
      plan: "legacy",
      teamId: null,
      apiKeyId: null,
      label: null,
      scope: FULL_ACCESS_SCOPE,
    };
  }

  return null;
}

async function lookupKeyByHash(env: Env, hash: string) {
  const sql = getDb(env);
  const rows = (await sql`
    SELECT k.id, k.team_id, k.label, k.scope_label_prefix, k.scope_read_only, t.plan AS team_plan
    FROM api_keys k
    JOIN teams t ON t.id = k.team_id
    WHERE k.key_hash = ${hash}
      AND k.revoked_at IS NULL
      AND (k.expires_at IS NULL OR k.expires_at > NOW())
    LIMIT 1
  `) as {
    id: string;
    team_id: string;
    label: string | null;
    team_plan: string;
    scope_label_prefix: string | null;
    scope_read_only: boolean;
  }[];
  return rows[0] ?? null;
}

export async function registerApiKey(
  env: Env,
  input: { token: string; teamName: string; label?: string; plan?: PlanId }
): Promise<{ teamId: string; apiKeyId: string; hint: string }> {
  const sql = getDb(env);
  const teamId = nanoid(10);
  const apiKeyId = nanoid(10);
  const hash = await apiKeyHashFromToken(input.token);
  const hint = await apiKeyHintFromToken(input.token);
  const plan = input.plan ?? "free";

  await sql`
    INSERT INTO teams (id, name, plan)
    VALUES (${teamId}, ${input.teamName}, ${plan})
  `;
  await sql`
    INSERT INTO api_keys (id, team_id, key_hash, key_hint, label)
    VALUES (${apiKeyId}, ${teamId}, ${hash}, ${hint}, ${input.label ?? null})
  `;

  return { teamId, apiKeyId, hint };
}

export async function setTeamPlan(
  env: Env,
  teamId: string,
  plan: PlanId,
  stripe?: { customerId?: string; subscriptionId?: string | null }
): Promise<void> {
  const sql = getDb(env);
  await sql`
    UPDATE teams
    SET plan = ${plan},
        stripe_customer_id = COALESCE(${stripe?.customerId ?? null}, stripe_customer_id),
        stripe_subscription_id = ${stripe?.subscriptionId ?? null}
    WHERE id = ${teamId}
  `;
}

export async function findTeamByStripeSubscription(
  env: Env,
  subscriptionId: string
): Promise<{ id: string } | null> {
  const sql = getDb(env);
  const rows = (await sql`
    SELECT id FROM teams
    WHERE stripe_subscription_id = ${subscriptionId}
    LIMIT 1
  `) as { id: string }[];
  return rows[0] ?? null;
}

export interface TeamRow {
  id: string;
  name: string;
  plan: string;
  created_at: string;
}

export interface TeamKeyRow {
  id: string;
  key_hint: string;
  label: string | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  scope_label_prefix: string | null;
  scope_read_only: boolean;
}

export async function getTeam(
  env: Env,
  teamId: string
): Promise<TeamRow | null> {
  const sql = getDb(env);
  const rows = (await sql`
    SELECT id, name, plan, created_at FROM teams WHERE id = ${teamId} LIMIT 1
  `) as TeamRow[];
  return rows[0] ?? null;
}

export async function getTeamBilling(
  env: Env,
  teamId: string
): Promise<{
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: string;
} | null> {
  const sql = getDb(env);
  const rows = (await sql`
    SELECT plan, stripe_customer_id, stripe_subscription_id
    FROM teams
    WHERE id = ${teamId}
    LIMIT 1
  `) as {
    plan: string;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
  }[];
  return rows[0] ?? null;
}

export async function listTeamKeys(
  env: Env,
  teamId: string
): Promise<TeamKeyRow[]> {
  const sql = getDb(env);
  return (await sql`
    SELECT id, key_hint, label, created_at, expires_at, revoked_at, scope_label_prefix, scope_read_only
    FROM api_keys
    WHERE team_id = ${teamId}
      AND revoked_at IS NULL
    ORDER BY created_at ASC
  `) as TeamKeyRow[];
}

export async function addTeamKey(
  env: Env,
  teamId: string,
  input: {
    token: string;
    label?: string;
    scope?: { labelPrefix?: string | null; readOnly?: boolean };
    expiresAt?: string | null;
  }
): Promise<{ apiKeyId: string; hint: string }> {
  const sql = getDb(env);
  const apiKeyId = nanoid(10);
  const hash = await apiKeyHashFromToken(input.token);
  const hint = await apiKeyHintFromToken(input.token);
  const scopePrefix = input.scope?.labelPrefix?.trim().slice(0, 64) || null;
  const scopeReadOnly = input.scope?.readOnly ?? false;
  await sql`
    INSERT INTO api_keys (id, team_id, key_hash, key_hint, label, scope_label_prefix, scope_read_only, expires_at)
    VALUES (${apiKeyId}, ${teamId}, ${hash}, ${hint}, ${input.label ?? null}, ${scopePrefix}, ${scopeReadOnly}, ${input.expiresAt ?? null})
  `;
  return { apiKeyId, hint };
}

export async function revokeTeamKey(
  env: Env,
  teamId: string,
  apiKeyId: string
): Promise<boolean> {
  const keys = await listTeamKeys(env, teamId);
  if (keys.length <= 1) return false;
  const sql = getDb(env);
  const rows = await sql`
    DELETE FROM api_keys
    WHERE id = ${apiKeyId} AND team_id = ${teamId}
    RETURNING id
  `;
  return rows.length > 0;
}

export async function countTeamKeys(env: Env, teamId: string): Promise<number> {
  const sql = getDb(env);
  const rows = (await sql`
    SELECT COUNT(*)::int AS count
    FROM api_keys
    WHERE team_id = ${teamId}
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > NOW())
  `) as { count: number }[];
  return rows[0]?.count ?? 0;
}

/**
 * Replace every active key of a team with one new key (leaked or lost key).
 * Order keeps the team usable if a step fails: add the new key, move inboxes and
 * custom domains to it, then revoke the old keys.
 */
export async function rotateTeamKeys(
  env: Env,
  teamId: string,
  input: { token: string; label?: string }
): Promise<{ apiKeyId: string; hint: string; revoked: number; movedInboxes: number }> {
  const sql = getDb(env);
  const old = (await sql`
    SELECT id, key_hint FROM api_keys
    WHERE team_id = ${teamId} AND revoked_at IS NULL
  `) as { id: string; key_hint: string }[];

  const { apiKeyId, hint } = await addTeamKey(env, teamId, { token: input.token, label: input.label });
  const oldHints = [...new Set(old.map((k) => k.key_hint))];
  const oldIds = old.map((k) => k.id);

  let movedInboxes = 0;
  if (oldHints.length) {
    const moved = await sql`
      UPDATE inboxes SET api_key_hint = ${hint}
      WHERE api_key_hint = ANY(${oldHints}::text[])
      RETURNING id
    `;
    movedInboxes = moved.length;
    await sql`UPDATE domains SET api_key_hint = ${hint} WHERE api_key_hint = ANY(${oldHints}::text[])`;
  }
  if (oldIds.length) {
    await sql`UPDATE api_keys SET revoked_at = NOW() WHERE id = ANY(${oldIds}::text[]) AND team_id = ${teamId}`;
  }
  return { apiKeyId, hint, revoked: oldIds.length, movedInboxes };
}

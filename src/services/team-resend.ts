/** Enterprise: per-team Resend API + webhook (isolated domain infra) */
import type { Env } from "../env";
import { getDb } from "../db/client";
import { decryptTeamSecret, encryptTeamSecret } from "../lib/team-secrets";
import { createResendClient } from "./resend-mail";
import type { Resend } from "resend";
import type { PlanId } from "../lib/plans";
import { publicApiOrigin } from "../lib/public-origin";

export type DedicatedResendStatus = {
  configured: boolean;
  configuredAt: string | null;
  webhookUrl: string;
  planRequired: "enterprise";
};

type TeamResendRow = {
  dedicated_resend_api_key_cipher: string | null;
  dedicated_resend_webhook_secret_cipher: string | null;
  dedicated_resend_configured_at: string | null;
  plan: string;
};

async function getTeamResendRow(
  env: Env,
  teamId: string
): Promise<TeamResendRow | null> {
  const sql = getDb(env);
  const rows = (await sql`
    SELECT dedicated_resend_api_key_cipher,
           dedicated_resend_webhook_secret_cipher,
           dedicated_resend_configured_at,
           plan
    FROM teams
    WHERE id = ${teamId}
    LIMIT 1
  `) as TeamResendRow[];
  return rows[0] ?? null;
}

export function dedicatedWebhookUrl(teamId: string, configuredOrigin?: string): string {
  return `${publicApiOrigin(configuredOrigin)}/webhooks/resend/team/${teamId}`;
}

export function isEnterprisePlan(plan: PlanId): boolean {
  return plan === "enterprise";
}

export async function getDedicatedResendStatus(
  env: Env,
  teamId: string
): Promise<DedicatedResendStatus> {
  const row = await getTeamResendRow(env, teamId);
  return {
    configured: Boolean(row?.dedicated_resend_api_key_cipher),
    configuredAt: row?.dedicated_resend_configured_at ?? null,
    webhookUrl: dedicatedWebhookUrl(teamId, env.MAILAGENT_PUBLIC_API_ORIGIN),
    planRequired: "enterprise",
  };
}

export async function teamHasDedicatedResend(
  env: Env,
  teamId: string
): Promise<boolean> {
  const row = await getTeamResendRow(env, teamId);
  return Boolean(row?.dedicated_resend_api_key_cipher);
}

export async function getTeamResendApiKey(
  env: Env,
  teamId: string
): Promise<string | null> {
  const row = await getTeamResendRow(env, teamId);
  if (!row?.dedicated_resend_api_key_cipher) return null;
  return decryptTeamSecret(env, row.dedicated_resend_api_key_cipher);
}

export async function getTeamWebhookSecret(
  env: Env,
  teamId: string
): Promise<string | null> {
  const row = await getTeamResendRow(env, teamId);
  if (!row?.dedicated_resend_webhook_secret_cipher) return null;
  return decryptTeamSecret(env, row.dedicated_resend_webhook_secret_cipher);
}

export async function createResendClientForTeam(
  env: Env,
  teamId: string | null
): Promise<Resend> {
  if (teamId) {
    const key = await getTeamResendApiKey(env, teamId);
    if (key) return createResendClient(env, key);
  }
  return createResendClient(env);
}

export async function setTeamDedicatedResend(
  env: Env,
  teamId: string,
  input: { resendApiKey: string; webhookSecret: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = input.resendApiKey.trim();
  const webhookSecret = input.webhookSecret.trim();
  if (!apiKey.startsWith("re_")) {
    return { ok: false, error: "invalid_resend_api_key" };
  }
  if (webhookSecret.length < 8) {
    return { ok: false, error: "invalid_webhook_secret" };
  }

  const apiCipher = await encryptTeamSecret(env, apiKey);
  const whCipher = await encryptTeamSecret(env, webhookSecret);
  const sql = getDb(env);
  await sql`
    UPDATE teams
    SET dedicated_resend_api_key_cipher = ${apiCipher},
        dedicated_resend_webhook_secret_cipher = ${whCipher},
        dedicated_resend_configured_at = NOW()
    WHERE id = ${teamId}
  `;
  return { ok: true };
}

export async function clearTeamDedicatedResend(
  env: Env,
  teamId: string
): Promise<boolean> {
  const sql = getDb(env);
  const rows = await sql`
    UPDATE teams
    SET dedicated_resend_api_key_cipher = NULL,
        dedicated_resend_webhook_secret_cipher = NULL,
        dedicated_resend_configured_at = NULL
    WHERE id = ${teamId}
    RETURNING id
  `;
  return rows.length > 0;
}

export async function resolveResendTeamForDomain(
  env: Env,
  scope: { teamId: string | null; plan: PlanId }
): Promise<
  | { ok: true; teamId: string | null; client: Resend }
  | { ok: false; error: string; hint?: string }
> {
  if (scope.teamId && isEnterprisePlan(scope.plan)) {
    const configured = await teamHasDedicatedResend(env, scope.teamId);
    if (!configured) {
      return {
        ok: false,
        error: "dedicated_resend_required",
        hint: `Enterprise teams must configure PUT /v1/team/dedicated-resend before custom domains. Webhook: ${dedicatedWebhookUrl(scope.teamId, env.MAILAGENT_PUBLIC_API_ORIGIN)}`,
      };
    }
    const client = await createResendClientForTeam(env, scope.teamId);
    return { ok: true, teamId: scope.teamId, client };
  }

  if (scope.teamId && (await teamHasDedicatedResend(env, scope.teamId))) {
    const client = await createResendClientForTeam(env, scope.teamId);
    return { ok: true, teamId: scope.teamId, client };
  }

  return {
    ok: true,
    teamId: null,
    client: createResendClient(env),
  };
}

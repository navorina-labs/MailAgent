/** Monthly email cap per team: inbound and outbound mail that goes through Resend. */
import type { Env } from "../env";
import { getDb } from "../db/client";
import { PLAN_LIMITS, normalizePlan } from "../lib/plans";
import { monthKey } from "../lib/stripe-core";

export const MONTHLY_QUOTA_ERROR = "monthly_quota_exceeded";

export type EmailQuotaResult =
  | { ok: true }
  | { ok: false; limit: number; plan: string };

export function monthlyQuotaMessage(limit: number, plan: string): string {
  const upgrade = plan === "free" ? " Upgrade to Pro for 5000 a month." : "";
  return `${MONTHLY_QUOTA_ERROR}: ${limit} emails per month on the ${plan} plan. The counter resets on the 1st (UTC).${upgrade}`;
}

/**
 * Count one email for the team and say whether it fits the plan's monthly cap.
 * Check and increment happen in one statement, so parallel sends cannot overshoot.
 * Teams without a cap (enterprise, legacy) and keys without a team are not counted.
 */
export async function consumeMonthlyEmail(
  env: Env,
  teamId: string | null | undefined,
  rawPlan?: string | null
): Promise<EmailQuotaResult> {
  if (!teamId) return { ok: true };
  const sql = getDb(env);
  let planRaw = rawPlan;
  if (planRaw === undefined) {
    const rows = (await sql`SELECT plan FROM teams WHERE id = ${teamId} LIMIT 1`) as { plan: string }[];
    if (!rows[0]) return { ok: true };
    planRaw = rows[0].plan;
  }
  const plan = normalizePlan(planRaw);
  const limit = PLAN_LIMITS[plan].monthlyEmails;
  if (limit === null) return { ok: true };

  let rows: { count: number }[];
  try {
    rows = (await sql`
      INSERT INTO team_email_usage (team_id, month, count)
      VALUES (${teamId}, ${monthKey()}, 1)
      ON CONFLICT (team_id, month) DO UPDATE
        SET count = team_email_usage.count + 1, updated_at = NOW()
        WHERE team_email_usage.count < ${limit}
      RETURNING count
    `) as { count: number }[];
  } catch (e) {
    // Fail open (e.g. migration 029 not applied yet): mail delivery matters more than the cap.
    console.warn("email_usage_unavailable", e instanceof Error ? e.message : String(e));
    return { ok: true };
  }
  return rows.length ? { ok: true } : { ok: false, limit, plan };
}

/** Throws "monthly_quota_exceeded: …" when the team is over its cap. */
export async function assertMonthlyEmail(env: Env, teamId: string | null | undefined): Promise<void> {
  const res = await consumeMonthlyEmail(env, teamId);
  if (!res.ok) throw new Error(monthlyQuotaMessage(res.limit, res.plan));
}

export async function monthlyEmailsUsed(env: Env, teamId: string | null | undefined): Promise<number> {
  if (!teamId) return 0;
  const sql = getDb(env);
  try {
    const rows = (await sql`
      SELECT count FROM team_email_usage WHERE team_id = ${teamId} AND month = ${monthKey()} LIMIT 1
    `) as { count: number }[];
    return rows[0]?.count ?? 0;
  } catch {
    return 0;
  }
}

export type MonthlyQuotaStatus = {
  error: typeof MONTHLY_QUOTA_ERROR;
  plan: string;
  limit: number;
  used: number;
  message: string;
};

/** Over-cap status for explaining a wait timeout; null when the team is under its cap or has none. */
export function monthlyQuotaStatus(used: number, rawPlan: string | null | undefined): MonthlyQuotaStatus | null {
  const plan = normalizePlan(rawPlan);
  const limit = PLAN_LIMITS[plan].monthlyEmails;
  if (limit === null || used < limit) return null;
  return {
    error: MONTHLY_QUOTA_ERROR,
    plan,
    limit,
    used,
    message: `${monthlyQuotaMessage(limit, plan)} Inbound email is not delivered until then.`,
  };
}

/** Is the team that owns this inbox over its monthly cap? Never throws. */
export async function monthlyQuotaForInbox(env: Env, inboxId: string): Promise<MonthlyQuotaStatus | null> {
  try {
    const rows = (await getDb(env)`
      SELECT t.id AS team_id, t.plan
      FROM inboxes i
      JOIN api_keys k ON k.key_hint = i.api_key_hint
      JOIN teams t ON t.id = k.team_id
      WHERE i.id = ${inboxId}
      LIMIT 1
    `) as { team_id: string; plan: string }[];
    if (!rows[0]) return null;
    if (PLAN_LIMITS[normalizePlan(rows[0].plan)].monthlyEmails === null) return null;
    return monthlyQuotaStatus(await monthlyEmailsUsed(env, rows[0].team_id), rows[0].plan);
  } catch {
    return null;
  }
}

/** Inbound: find the team that owns an inbox (via its API key hint) and its plan. */
export async function teamForInboxKey(
  env: Env,
  apiKeyHint: string | null | undefined
): Promise<{ teamId: string; plan: string } | null> {
  if (!apiKeyHint?.trim()) return null;
  const sql = getDb(env);
  const rows = (await sql`
    SELECT t.id AS team_id, t.plan
    FROM api_keys k JOIN teams t ON t.id = k.team_id
    WHERE k.key_hint = ${apiKeyHint.trim()}
    LIMIT 1
  `) as { team_id: string; plan: string }[];
  return rows[0] ? { teamId: rows[0].team_id, plan: rows[0].plan } : null;
}

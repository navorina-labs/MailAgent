/** Hourly abuse check: flag or suspend teams whose inboxes get mail from many unrelated senders. */
import type { Env } from "../env";
import { getDb } from "../db/client";
import { abuseVerdict, type TeamActivity } from "../lib/abuse";
import { createResendClient } from "./resend-mail";

const DEFAULT_ALERT_INBOX = "hello@webmailagent.com";

export async function teamActivity24h(env: Env): Promise<TeamActivity[]> {
  const sql = getDb(env);
  const rows = (await sql`
    SELECT k.team_id,
           t.plan,
           COUNT(DISTINCT substring(substring(lower(m.from_addr) from '@([^>[:space:]]+)') from '([^.]+[.][^.]+)$'))::int AS sender_domains,
           COUNT(DISTINCT m.id)::int AS messages,
           COUNT(DISTINCT i.id)::int AS inboxes
    FROM messages m
    JOIN inboxes i ON i.id = m.inbox_id
    JOIN api_keys k ON k.key_hint = i.api_key_hint
    JOIN teams t ON t.id = k.team_id
    WHERE m.received_at > NOW() - INTERVAL '24 hours'
      AND m.provider_id NOT LIKE 'sim\\_%'
      AND t.suspended_at IS NULL
    GROUP BY k.team_id, t.plan
    HAVING COUNT(DISTINCT m.id) > 5
  `) as { team_id: string; plan: string; sender_domains: number; messages: number; inboxes: number }[];
  return rows.map((r) => ({
    teamId: r.team_id,
    plan: r.plan,
    senderDomains: r.sender_domains,
    messages: r.messages,
    inboxes: r.inboxes,
  }));
}

export async function suspendTeam(env: Env, teamId: string, reason: string): Promise<void> {
  await getDb(env)`
    UPDATE teams SET suspended_at = NOW(), suspended_reason = ${reason.slice(0, 500)}
    WHERE id = ${teamId} AND suspended_at IS NULL
  `;
}

async function alertOnce(env: Env, key: string, subject: string, text: string): Promise<boolean> {
  const kv = env.RATE_LIMIT;
  const from = env.OUTBOUND_FROM?.trim();
  if (!from || !env.RESEND_API_KEY) return false;
  if (kv && (await kv.get(key))) return false;
  const { error } = await createResendClient(env).emails.send({
    from,
    to: [env.PILOT_INBOX?.trim() || DEFAULT_ALERT_INBOX],
    subject,
    text,
  });
  if (error) {
    console.error("abuse_alert_send_failed", error.message);
    return false;
  }
  if (kv) await kv.put(key, "1", { expirationTtl: 24 * 3600 });
  return true;
}

export async function runAbuseGuard(env: Env): Promise<{ checked: number; flagged: number; suspended: number }> {
  let activity: TeamActivity[];
  try {
    activity = await teamActivity24h(env);
  } catch (e) {
    console.warn("abuse_guard_unavailable", e instanceof Error ? e.message : String(e));
    return { checked: 0, flagged: 0, suspended: 0 };
  }

  let flagged = 0;
  let suspended = 0;
  const day = new Date().toISOString().slice(0, 10);
  for (const a of activity) {
    const v = abuseVerdict(a);
    if (v.level === "ok") continue;
    const reason = v.reasons.join("; ");
    if (v.level === "suspend") {
      await suspendTeam(env, a.teamId, `auto: ${reason}`);
      suspended++;
    } else {
      flagged++;
    }
    const lines = [
      `Team: ${a.teamId} (plan ${a.plan})`,
      `Action: ${v.level === "suspend" ? "SUSPENDED automatically, keys stop working" : "flagged only, nothing changed"}`,
      `Why: ${reason}`,
      `Inboxes with mail in 24h: ${a.inboxes}`,
      "",
      "Look:    npm run team:abuse -- " + a.teamId,
      "Suspend: npm run team:suspend -- " + a.teamId + ' "reason"',
      "Lift:    npm run team:unsuspend -- " + a.teamId,
    ];
    await alertOnce(
      env,
      `abuse:alert:${a.teamId}:${v.level}:${day}`,
      `Mail Agent abuse ${v.level === "suspend" ? "SUSPENDED" : "flag"}: team ${a.teamId}`,
      lines.join("\n")
    );
  }
  return { checked: activity.length, flagged, suspended };
}

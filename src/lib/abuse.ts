/**
 * Abuse guard thresholds. Testing your own product brings mail from a few senders
 * (your app, maybe an auth provider). Mail from many unrelated domains in one day
 * means signups on other sites: that gets our inbox domain blocklisted for everyone.
 */
import type { PlanId } from "./plans";

export type TeamActivity = {
  teamId: string;
  plan: string;
  senderDomains: number;
  messages: number;
  inboxes: number;
};

export type AbuseVerdict = { level: "ok" } | { level: "flag" | "suspend"; reasons: string[] };

const LIMITS: Record<PlanId, { flagDomains: number; suspendDomains: number | null; flagMessages: number }> = {
  free: { flagDomains: 15, suspendDomains: 40, flagMessages: 300 },
  pro: { flagDomains: 50, suspendDomains: null, flagMessages: 3000 },
  enterprise: { flagDomains: 200, suspendDomains: null, flagMessages: 20000 },
  legacy: { flagDomains: 50, suspendDomains: null, flagMessages: 3000 },
};

export function abuseVerdict(a: TeamActivity): AbuseVerdict {
  const plan = (["free", "pro", "enterprise", "legacy"].includes(a.plan) ? a.plan : "free") as PlanId;
  const l = LIMITS[plan];
  const reasons: string[] = [];
  if (a.senderDomains > l.flagDomains) reasons.push(`${a.senderDomains} sender domains in 24h (flag above ${l.flagDomains})`);
  if (a.messages > l.flagMessages) reasons.push(`${a.messages} messages in 24h (flag above ${l.flagMessages})`);
  if (!reasons.length) return { level: "ok" };
  if (l.suspendDomains !== null && a.senderDomains > l.suspendDomains) return { level: "suspend", reasons };
  return { level: "flag", reasons };
}

/** "Acme <no-reply@mail.acme.dev>" → "acme.dev" (last two labels; good enough for counting). */
export function senderDomain(fromAddr: string): string | null {
  const m = /@([^\s>]+)/.exec(String(fromAddr || ""));
  if (!m) return null;
  const parts = m[1].toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
  if (parts.length < 2) return null;
  return parts.slice(-2).join(".");
}

export const SUSPENDED_MESSAGE =
  "This account is suspended for mail activity that looks like signups on other sites. Write to hello@webmailagent.com.";

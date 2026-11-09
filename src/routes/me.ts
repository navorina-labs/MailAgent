/** Key profile: plan, limits, usage */
import { Hono } from "hono";
import type { Env } from "../env";
import type { ApiVariables } from "../lib/api-context";
import { requireApiKey } from "../lib/auth";
import { rateLimit } from "../lib/rate-limit";
import { PLAN_LIMITS } from "../lib/plans";
import { canUpgradeViaStripe, stripeConfigured } from "../services/billing";
import { getTeamBilling } from "../services/api-key-store";
import { getScopedUsage } from "../services/console-stats";
import { outboundCapabilities } from "../lib/outbound-capabilities";
import { getDedicatedResendStatus } from "../services/team-resend";
import { getRateLimitUsage } from "../lib/rate-limit-usage";
import { monthlyEmailsUsed } from "../services/email-usage";

export const meRoutes = new Hono<{ Bindings: Env; Variables: ApiVariables }>();

meRoutes.use("*", requireApiKey);
meRoutes.use("*", rateLimit);

meRoutes.get("/", async (c) => {
  const hint = c.get("apiKeyHint");
  const plan = c.get("apiPlan");
  const teamId = c.get("teamId");
  const limits = PLAN_LIMITS[plan];
  const usageRaw = await getScopedUsage(c.env, {
    teamId,
    apiKeyHint: hint,
    plan,
  });

  let canManagePortal = false;
  if (teamId && stripeConfigured(c.env)) {
    const bill = await getTeamBilling(c.env, teamId);
    canManagePortal = Boolean(bill?.stripe_customer_id);
  }

  const dedicatedResend =
    teamId && limits.dedicatedResend
      ? await getDedicatedResendStatus(c.env, teamId)
      : null;

  const rateLimit = await getRateLimitUsage(c.env, hint, limits.rateLimitPerMinute);
  const emailsThisMonth = limits.monthlyEmails === null ? null : await monthlyEmailsUsed(c.env, teamId);

  return c.json({
    plan,
    teamId: c.get("teamId"),
    apiKeyId: c.get("apiKeyId"),
    scope: c.get("apiKeyScope"),
    limits: {
      rateLimitPerMinute: limits.rateLimitPerMinute,
      maxActiveInboxes: limits.maxActiveInboxes,
      maxTeamKeys: limits.maxTeamKeys,
      maxCustomDomains: limits.maxCustomDomains,
      notifyEmailsPerDay: limits.notifyEmailsPerDay,
      monthlyEmails: limits.monthlyEmails,
    },
    usage: {
      activeInboxes: usageRaw.activeInboxes,
      inboxesRemaining: Math.max(
        0,
        limits.maxActiveInboxes - usageRaw.activeInboxes
      ),
      customDomains: usageRaw.customDomains,
      domainsRemaining: Math.max(
        0,
        limits.maxCustomDomains - usageRaw.customDomains
      ),
      teamKeys: usageRaw.teamKeys,
      messagesLast24h: usageRaw.messagesLast24h,
      notifyEmailsLast24h: usageRaw.notifyEmailsLast24h,
      emailsThisMonth,
      notifyEmailsRemaining: Math.max(
        0,
        limits.notifyEmailsPerDay - usageRaw.notifyEmailsLast24h
      ),
    },
    billing: {
      stripeEnabled: stripeConfigured(c.env) && Boolean(teamId),
      canUpgrade:
        stripeConfigured(c.env) && Boolean(teamId) && canUpgradeViaStripe(plan),
      canManagePortal,
      checkoutPath: "/v1/billing/checkout",
      portalPath: "/v1/billing/portal",
      consolePath: "/v1/console/summary",
    },
    rateLimit,
    capabilities: {
      outbound: await outboundCapabilities(c.env, {
        teamId,
        plan,
      }),
      dedicatedResend,
    },
  });
});

/** Relay extracted verification summary to developer's real email via Resend */
import type { Env } from "../env";
import type { InboxRow } from "./inbox";
import type { MessageVerification } from "./message-verify";
import {
  countNotifyQuotaEvents24h,
  recordNotifyDelivery,
  recordNotifyQuotaEvent,
} from "./notify-log";
import { createResendClient } from "./resend-mail";
import { debugUiUrl } from "./inbox-diagnose";
import { PLAN_LIMITS, normalizePlan } from "../lib/plans";
import { getTeam } from "./api-key-store";
import { getTeamIdByApiKeyHint } from "./team-event-webhook";
import { publicApiOrigin } from "../lib/public-origin";

export type NotifyMailInput = {
  inbox: InboxRow;
  messageId: string;
  verification: MessageVerification;
  apiBaseUrl?: string;
};

export type NotifyMailResult = {
  ok: boolean;
  resendId: string | null;
  error?: string;
};

function outboundFrom(env: Env, inbox: InboxRow): string {
  const custom = env.OUTBOUND_FROM?.trim();
  if (custom) return custom;
  return `MailAgent <noreply@${env.INBOX_DOMAIN}>`;
}

function buildNotifyBodies(
  inbox: InboxRow,
  verification: MessageVerification,
  debugUrl: string
): { subject: string; text: string; html: string } {
  const label = inbox.label ? ` (${inbox.label})` : "";
  const subject = `[MailAgent]${label} ${verification.subject || "Verification"}`;

  const lines = [
    "MailAgent — verification relay",
    "",
    `Signup address: ${inbox.address}`,
    inbox.label ? `Label: ${inbox.label}` : null,
    `From: ${verification.from}`,
    `Subject: ${verification.subject}`,
    "",
    verification.otp ? `OTP: ${verification.otp}` : null,
    verification.primaryLink ? `Primary link: ${verification.primaryLink}` : null,
    !verification.otp && !verification.primaryLink
      ? "No OTP or link extracted — open debug UI."
      : null,
    "",
    `Debug: ${debugUrl}`,
    `Expires: ${inbox.expires_at}`,
  ].filter((line): line is string => Boolean(line));

  const text = lines.join("\n");
  const html = lines
    .map((line) => {
      if (line.startsWith("OTP: ")) {
        const otp = line.slice(5);
        return `<p><strong>OTP:</strong> <code>${otp}</code></p>`;
      }
      if (line.startsWith("Primary link: ")) {
        const url = line.slice(14);
        return `<p><strong>Link:</strong> <a href="${url}">${url}</a></p>`;
      }
      if (line.startsWith("Debug: ")) {
        const url = line.slice(7);
        return `<p><a href="${url}">Open debug UI</a></p>`;
      }
      if (line === "") return "<br>";
      return `<p>${line}</p>`;
    })
    .join("\n");

  return { subject, text, html };
}

export async function fireInboxNotify(
  env: Env,
  input: NotifyMailInput
): Promise<NotifyMailResult> {
  const notifyEmail = input.inbox.notify_email?.trim();
  if (!notifyEmail) {
    return { ok: false, resendId: null, error: "notify_email_not_set" };
  }

  const started = Date.now();
  const apiKeyHint = input.inbox.api_key_hint?.trim() ?? "";
  const teamId = await getTeamIdByApiKeyHint(env, apiKeyHint);
  const team = teamId ? await getTeam(env, teamId) : null;
  const plan = teamId ? normalizePlan(team?.plan) : "legacy";
  const limit = PLAN_LIMITS[plan].notifyEmailsPerDay;
  const used = await countNotifyQuotaEvents24h(env, { teamId, apiKeyHint });
  if (used >= limit) {
    const durationMs = Date.now() - started;
    const error = "notify_quota_exceeded";
    await recordNotifyDelivery(env, {
      inboxId: input.inbox.id,
      messageId: input.messageId,
      notifyEmail,
      ok: false,
      errorText: error,
      durationMs,
    });
    return { ok: false, resendId: null, error };
  }
  if (apiKeyHint) {
    await recordNotifyQuotaEvent(env, {
      teamId,
      apiKeyHint,
      inboxId: input.inbox.id,
      notifyEmail,
    });
  }

  const apiBase =
    input.apiBaseUrl?.replace(/\/$/, "") ??
    publicApiOrigin(env.MAILAGENT_PUBLIC_API_ORIGIN);
  const debugUrl = debugUiUrl(apiBase, input.inbox.id);
  const { subject, text, html } = buildNotifyBodies(
    input.inbox,
    input.verification,
    debugUrl
  );

  if (!env.OUTBOUND_FROM?.trim()) {
    const durationMs = Date.now() - started;
    const error = "outbound_not_configured";
    await recordNotifyDelivery(env, {
      inboxId: input.inbox.id,
      messageId: input.messageId,
      notifyEmail,
      ok: false,
      errorText: error,
      durationMs,
    });
    return { ok: false, resendId: null, error };
  }

  let resendId: string | null = null;
  let ok = false;
  let errorText: string | null = null;

  try {
    const resend = createResendClient(env);
    const { data, error } = await resend.emails.send({
      from: outboundFrom(env, input.inbox),
      to: [notifyEmail],
      subject,
      text,
      html,
      headers: {
        "Reply-To": input.inbox.address,
      },
    });
    if (error || !data?.id) {
      errorText = error?.message ?? "resend send failed";
    } else {
      resendId = data.id;
      ok = true;
    }
  } catch (e) {
    errorText = e instanceof Error ? e.message : String(e);
  }

  const durationMs = Date.now() - started;
  await recordNotifyDelivery(env, {
    inboxId: input.inbox.id,
    messageId: input.messageId,
    notifyEmail,
    resendId,
    ok,
    errorText,
    durationMs,
  });

  return { ok, resendId, ...(errorText ? { error: errorText } : {}) };
}

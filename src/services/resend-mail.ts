import { Resend } from "resend";
import type { Env } from "../env";
import { isSenderAllowed } from "../lib/sender-allowlist";
import {
  buildPreviewText,
  extractLinks,
  extractOtp,
  primaryLink,
} from "./extract";
import { fireInboxCallback } from "./callback";
import { shouldFireNotify } from "../lib/notify-email";
import { fireInboxNotify } from "./notify-mail";
import { consumeMonthlyEmail, teamForInboxKey } from "./email-usage";
import { fireTeamEventForMessage } from "./team-event-webhook";
import {
  recordCallbackRunSession,
  recordMessageReceivedRunSession,
  recordNotifyRunSession,
  sessionOwnerKey,
} from "./agent-run-session";
import { parseRunIdFromLabel } from "../lib/agent-recipes";
import { getTeamIdByApiKeyHint } from "./team-event-webhook";
import {
  findInboxByAddress,
  insertMessage,
  type InboxRow,
  type MessageRow,
} from "./inbox";
import { storeRawMimeFromUrl } from "./raw-mime-r2";
import { saveAttachmentsFromEmail } from "./message-attachments";
import { formatMessageVerification } from "./message-verify";
import { indexMessageSearch } from "./message-search";
import {
  normalizeMessageId,
  parseMessageIdList,
  readInboundHeaders,
  resolveInboundThread,
} from "./thread-resolve";
import type { EmailQueueMessage, MessageNotifyPayload } from "../env";
import { nanoid } from "nanoid";

export function createResendClient(env: Env, apiKey?: string) {
  return new Resend(apiKey ?? env.RESEND_API_KEY);
}

/** Process queued message: fetch body, extract, save, notify DO */
export async function processInboundEmail(
  env: Env,
  job: EmailQueueMessage,
  notify: (
    inbox: InboxRow,
    payload: MessageNotifyPayload
  ) => Promise<void>
): Promise<void> {
  const resend = job.resendTeamId
    ? await (
        await import("./team-resend")
      ).createResendClientForTeam(env, job.resendTeamId)
    : createResendClient(env);

  let inbox = null;
  for (const rawTo of job.to) {
    inbox = await findInboxByAddress(env, rawTo);
    if (inbox) break;
  }
  if (!inbox) return;

  if (!isSenderAllowed(job.from, inbox.allowed_senders)) {
    return;
  }

  // Monthly cap: over the limit we skip fetching the body from Resend and drop the message.
  const owner = await teamForInboxKey(env, inbox.api_key_hint);
  if (owner) {
    const quota = await consumeMonthlyEmail(env, owner.teamId, owner.plan);
    if (!quota.ok) {
      console.warn("inbound_dropped_monthly_quota", owner.teamId, inbox.id);
      return;
    }
  }

  const { data: email, error } = await resend.emails.receiving.get(job.emailId);
  if (error || !email) {
    throw new Error(error?.message ?? "receiving.get failed");
  }

  const text = email.text ?? "";
  const html = email.html ?? "";
  const combined = `${text}\n${html}`;
  const otp = extractOtp(combined);
  const links = extractLinks(combined);

  const messageId = nanoid(16);
  let rawR2Key: string | null = null;
  const rawDownload = readRawDownloadUrl(email);
  if (rawDownload) {
    rawR2Key = await storeRawMimeFromUrl(
      env,
      inbox.id,
      messageId,
      rawDownload
    );
  }

  const inboundHeaders = readInboundHeaders(email);
  const resolved = await resolveInboundThread(
    env,
    {
      inboxId: inbox.id,
      subject: job.subject,
      inReplyTo: inboundHeaders.inReplyTo,
      references: inboundHeaders.references,
      headers:
        email && typeof email === "object" && email.headers
          ? (email.headers as Record<string, string | string[] | undefined>)
          : null,
    },
    messageId
  );

  const rfcMessageId = inboundHeaders.messageId
    ? normalizeMessageId(
        parseMessageIdList(inboundHeaders.messageId)[0] ??
          inboundHeaders.messageId
      )
    : resolved.rfcMessageId;

  const row = await insertMessage(env, {
    id: messageId,
    inboxId: inbox.id,
    providerId: job.emailId,
    from: job.from,
    subject: job.subject,
    textPreview: buildPreviewText(text),
    htmlPreview: buildPreviewText(html, 4000),
    otp,
    links,
    rawR2Key,
    threadId: resolved.threadId,
    inReplyTo: resolved.inReplyToMessageId,
    rfcMessageId,
  });

  if (!row) return;

  await indexMessageSearch(env, row);

  const runId = parseRunIdFromLabel(inbox.label);
  let ownerKey: string | null = null;
  try {
    if (runId && inbox.api_key_hint) {
      const teamId = await getTeamIdByApiKeyHint(env, inbox.api_key_hint);
      ownerKey = sessionOwnerKey(teamId, inbox.api_key_hint);
    }
    if (runId && ownerKey) {
      await recordMessageReceivedRunSession(env, runId, ownerKey, {
        inboxId: inbox.id,
        messageId: row.id,
        from: row.from_addr,
        subject: row.subject,
        receivedAt: row.received_at,
      });
    }
  } catch {
    /* timeline is best-effort */
  }

  await saveAttachmentsFromEmail(
    env,
    inbox.id,
    row.id,
    job.emailId,
    email
  );

  const payload = toNotifyPayload(row, inbox.id);
  await notify(inbox, payload);

  if (inbox.callback_url) {
    const callback = await fireInboxCallback(env, {
      inboxId: inbox.id,
      messageId: row.id,
      callbackUrl: inbox.callback_url,
      apiKeyHint: inbox.api_key_hint,
      payload: {
        ...payload,
        address: inbox.address,
        label: inbox.label,
      },
    });
    await recordCallbackRunSession(env, inbox, {
      messageId: row.id,
      ok: callback.ok,
      statusCode: callback.statusCode,
    });
  }

  if (shouldFireNotify(inbox)) {
    const notifyResult = await fireInboxNotify(env, {
      inbox,
      messageId: row.id,
      verification: formatMessageVerification(row, inbox.id),
    });
    await recordNotifyRunSession(env, inbox, {
      messageId: row.id,
      ok: notifyResult.ok,
      resendId: notifyResult.resendId,
      ...(notifyResult.error ? { error: notifyResult.error } : {}),
    });
  }

  await fireTeamEventForMessage(env, {
    inbox,
    messageId: row.id,
    payload,
  });
}

function toNotifyPayload(row: MessageRow, inboxId: string): MessageNotifyPayload {
  const links = Array.isArray(row.links_json)
    ? row.links_json
    : (JSON.parse(String(row.links_json)) as string[]);
  const verification = formatMessageVerification(row, inboxId);
  return {
    id: row.id,
    inboxId: row.inbox_id,
    from: row.from_addr,
    subject: row.subject,
    otp: row.otp,
    links,
    primaryLink: primaryLink(links),
    receivedAt: row.received_at,
    verification,
  };
}

function readRawDownloadUrl(email: unknown): string | null {
  if (!email || typeof email !== "object") return null;
  const raw = (email as { raw?: { download_url?: string } }).raw;
  const url = raw?.download_url;
  return typeof url === "string" && url.startsWith("http") ? url : null;
}

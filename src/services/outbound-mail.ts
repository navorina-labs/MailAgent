/** Outbound mail from inbox via Resend (threads + reply; shared or team dedicated) */
import { nanoid } from "nanoid";
import type { Resend } from "resend";
import type { Env } from "../env";
import { getDb } from "../db/client";
import {
  getInbox,
  getMessage,
  insertMessage,
  type InboxRow,
  type MessageRow,
} from "./inbox";
import { extractLinks, extractOtp } from "./extract";
import { indexMessageSearch } from "./message-search";
import { createResendClient } from "./resend-mail";
import { assertMonthlyEmail } from "./email-usage";
import {
  createResendClientForTeam,
  teamHasDedicatedResend,
} from "./team-resend";

export type SendMailInput = {
  inboxId: string;
  apiKeyHint?: string;
  teamId?: string | null;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
  inReplyToMessageId?: string;
};

export type SendMailResult = {
  messageId: string;
  threadId: string;
  providerId: string;
  from: string;
  to: string[];
  subject: string;
};

export type ThreadSummary = {
  threadId: string;
  subject: string;
  messageCount: number;
  lastMessageAt: string;
  lastDirection: "inbound" | "outbound";
  participants: string[];
};

function sharedOutboundFrom(env: Env, inbox: InboxRow): string {
  const custom = env.OUTBOUND_FROM?.trim();
  if (custom) return custom;
  return `MailAgent <${inbox.address}>`;
}

async function resolveOutboundSend(
  env: Env,
  inbox: InboxRow,
  teamId: string | null | undefined
): Promise<{ resend: Resend; from: string; dedicatedResend: boolean }> {
  if (teamId && (await teamHasDedicatedResend(env, teamId))) {
    if (!inbox.domain_id) {
      throw new Error(
        "dedicated_outbound_requires_custom_domain_inbox: create inbox with domainId on a verified custom domain"
      );
    }
    return {
      resend: await createResendClientForTeam(env, teamId),
      from: `MailAgent <${inbox.address}>`,
      dedicatedResend: true,
    };
  }

  return {
    resend: createResendClient(env),
    from: sharedOutboundFrom(env, inbox),
    dedicatedResend: false,
  };
}

export async function sendFromInbox(
  env: Env,
  input: SendMailInput
): Promise<SendMailResult | null> {
  const inbox = await getInbox(env, input.inboxId, {
    apiKeyHint: input.apiKeyHint,
  });
  if (!inbox) return null;

  const to = input.to.map((a) => a.trim()).filter(Boolean);
  if (!to.length) return null;

  const subject = input.subject.trim();
  if (!subject) return null;

  const text = input.text?.trim() ?? "";
  const html =
    input.html?.trim() ??
    (text.replace(/\n/g, "<br>\n") || `<p>${text}</p>`);

  let threadId = nanoid(12);
  let inReplyTo: string | undefined;
  let references: string[] = [];
  let parent: MessageRow | null = null;

  if (input.inReplyToMessageId) {
    parent = await getMessage(env, inbox.id, input.inReplyToMessageId);
    if (parent) {
      inReplyTo = parent.rfc_message_id ?? parent.provider_id;
      threadId = parent.thread_id ?? parent.id;
      references = parent.rfc_message_id ? [parent.rfc_message_id] : [];
    }
  }

  const { resend, from } = await resolveOutboundSend(
    env,
    inbox,
    input.teamId
  );
  await assertMonthlyEmail(env, input.teamId);
  const headers: Record<string, string> = {
    "Reply-To": inbox.address,
  };
  if (inReplyTo) {
    headers["In-Reply-To"] = inReplyTo;
    headers.References = references.length ? references.join(" ") : inReplyTo;
  }

  const { data, error } = await resend.emails.send({
    from,
    to,
    cc: input.cc?.length ? input.cc : undefined,
    bcc: input.bcc?.length ? input.bcc : undefined,
    subject,
    text: text || undefined,
    html,
    headers,
  });

  if (error || !data?.id) {
    throw new Error(error?.message ?? "resend send failed");
  }

  const messageId = nanoid(16);
  const combined = `${text}\n${html}`;
  const row = await insertMessage(env, {
    id: messageId,
    inboxId: inbox.id,
    providerId: data.id,
    from,
    subject,
    textPreview: text.slice(0, 2000) || null,
    htmlPreview: html.slice(0, 4000) || null,
    otp: extractOtp(combined),
    links: extractLinks(combined),
    direction: "outbound",
    threadId,
    inReplyTo: parent?.id ?? null,
    toAddrs: to,
    rfcMessageId: data.id ? `<${data.id}@resend>` : null,
  });

  if (!row) return null;

  await indexMessageSearch(env, row);

  return {
    messageId: row.id,
    threadId,
    providerId: data.id,
    from,
    to,
    subject,
  };
}

export async function listThreads(
  env: Env,
  inboxId: string
): Promise<ThreadSummary[]> {
  const sql = getDb(env);
  const rows = (await sql`
    SELECT
      COALESCE(thread_id, id) AS thread_id,
      MAX(subject) AS subject,
      COUNT(*)::int AS message_count,
      MAX(received_at) AS last_message_at,
      (ARRAY_AGG(direction ORDER BY received_at DESC))[1] AS last_direction,
      ARRAY_AGG(DISTINCT from_addr) AS from_addrs
    FROM messages
    WHERE inbox_id = ${inboxId}
    GROUP BY COALESCE(thread_id, id)
    ORDER BY last_message_at DESC
  `) as {
    thread_id: string;
    subject: string;
    message_count: number;
    last_message_at: string;
    last_direction: string;
    from_addrs: string[];
  }[];

  return rows.map((r) => ({
    threadId: r.thread_id,
    subject: r.subject,
    messageCount: r.message_count,
    lastMessageAt: r.last_message_at,
    lastDirection: r.last_direction === "outbound" ? "outbound" : "inbound",
    participants: r.from_addrs ?? [],
  }));
}

export async function listThreadMessages(
  env: Env,
  inboxId: string,
  threadId: string
): Promise<MessageRow[]> {
  const sql = getDb(env);
  const rows = (await sql`
    SELECT id, inbox_id, provider_id, from_addr, subject,
           text_preview, html_preview, otp, links_json, received_at,
           raw_r2_key, direction, thread_id, in_reply_to, to_addrs, rfc_message_id
    FROM messages
    WHERE inbox_id = ${inboxId}
      AND COALESCE(thread_id, id) = ${threadId}
    ORDER BY received_at ASC
  `) as MessageRow[];
  return rows;
}

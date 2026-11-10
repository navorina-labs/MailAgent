/** QA/dev: inject test message without Resend (bypasses allowlist ingest) */
import { nanoid } from "nanoid";
import type { Env, MessageNotifyPayload } from "../env";
import { primaryLink } from "./extract";
import { getInbox, getMessage, insertMessage, type MessageRow } from "./inbox";
import { fireInboxCallback } from "./callback";
import { shouldFireNotify } from "../lib/notify-email";
import { fireInboxNotify } from "./notify-mail";
import { fireTeamEventForMessage } from "./team-event-webhook";
import { formatMessageVerification } from "./message-verify";
import {
  recordCallbackRunSession,
  recordMessageReceivedRunSession,
  recordNotifyRunSession,
  sessionOwnerKey,
} from "./agent-run-session";
import { parseRunIdFromLabel } from "../lib/agent-recipes";
import { getTeamIdByApiKeyHint } from "./team-event-webhook";
import { getDb } from "../db/client";
import {
  normalizeMessageId,
  resolveInboundThread,
} from "./thread-resolve";
import { indexMessageSearch } from "./message-search";
import { resolveSimulateScenario } from "../lib/simulate-scenarios";

export type SimulateInboundInput = {
  inboxId: string;
  apiKeyHint?: string;
  /** Named fixture: otp | magic_link | attachment | invite | invoice_fixture */
  scenario?: string;
  otp?: string;
  from?: string;
  subject?: string;
  fireCallback?: boolean;
  attachmentFilename?: string;
  /** Parent message id — builds In-Reply-To for threading tests */
  inReplyToMessageId?: string;
  /** Optional RFC Message-ID for the simulated message */
  rfcMessageId?: string;
  inReplyTo?: string;
  references?: string;
  headers?: Record<string, string | string[] | undefined>;
};

export type SimulateInboundResult = {
  inboxId: string;
  messageId: string;
  threadId: string;
  address: string;
  otp: string | null;
  subject: string;
  scenario?: string;
  attachmentId?: string;
  callback?: { ok: boolean; statusCode: number | null };
  notify?: { ok: boolean; resendId: string | null; error?: string };
};

export async function simulateInboundMessage(
  env: Env,
  input: SimulateInboundInput
): Promise<SimulateInboundResult | null> {
  const inbox = await getInbox(env, input.inboxId, {
    apiKeyHint: input.apiKeyHint,
  });
  if (!inbox) return null;

  const fixture = resolveSimulateScenario(input.scenario);
  const otp =
    input.otp?.trim() ??
    (fixture?.otp !== undefined ? fixture.otp : undefined) ??
    "482910";
  const from =
    input.from?.trim() || fixture?.from || "qa-simulate@mailagent.test";
  const subject =
    input.subject?.trim() || fixture?.subject || "MailAgent simulated OTP";
  const links =
    fixture?.links?.length ? [...fixture.links] : ["https://example.com/verify?token=simulated"];
  const textPreview =
    fixture?.textPreview ?? `Your verification code is ${otp || "(link only)"}`;
  const htmlPreview = fixture?.htmlPreview ?? null;
  const attachmentFilename =
    input.attachmentFilename?.trim() || fixture?.attachmentFilename;
  const fireCallback =
    input.fireCallback === true || fixture?.fireCallback === true;
  const messageId = nanoid(16);
  const providerId = `sim_${nanoid(12)}`;

  let inReplyToHeader = input.inReplyTo ?? null;
  let referencesHeader = input.references ?? null;
  const headers: Record<string, string | string[] | undefined> = {
    ...(input.headers ?? {}),
  };

  if (input.inReplyToMessageId) {
    const parent = await getMessage(env, inbox.id, input.inReplyToMessageId);
    if (parent && parent.inbox_id === inbox.id) {
      const ref =
        parent.rfc_message_id ??
        (parent.provider_id ? `<${parent.provider_id}>` : null);
      if (ref) {
        inReplyToHeader = ref.startsWith("<") ? ref : `<${ref}>`;
        referencesHeader = referencesHeader ?? inReplyToHeader;
      }
    }
  }

  if (input.rfcMessageId?.trim()) {
    const mid = normalizeMessageId(input.rfcMessageId);
    headers["Message-ID"] = `<${mid}>`;
  }

  const resolved = await resolveInboundThread(
    env,
    {
      inboxId: inbox.id,
      subject,
      inReplyTo: inReplyToHeader,
      references: referencesHeader,
      headers,
    },
    messageId
  );

  const rfcMessageId = input.rfcMessageId?.trim()
    ? normalizeMessageId(input.rfcMessageId)
    : resolved.rfcMessageId;

  const row = await insertMessage(env, {
    id: messageId,
    inboxId: inbox.id,
    providerId,
    from,
    subject,
    textPreview,
    htmlPreview,
    otp: otp || null,
    links,
    threadId: resolved.threadId,
    inReplyTo: resolved.inReplyToMessageId,
    rfcMessageId,
  });
  if (!row) return null;

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

  let attachmentId: string | undefined;
  if (attachmentFilename) {
    attachmentId = await insertSimulatedAttachment(
      env,
      row.id,
      attachmentFilename
    );
  }

  const payload = toNotifyPayload(row, inbox.id);
  await notifyInboxWaiters(env, inbox.id, payload);

  let callback: SimulateInboundResult["callback"];
  if (fireCallback && inbox.callback_url) {
    callback = await fireInboxCallback(env, {
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

  let notify: SimulateInboundResult["notify"];
  if (shouldFireNotify(inbox)) {
    notify = await fireInboxNotify(env, {
      inbox,
      messageId: row.id,
      verification: formatMessageVerification(row, inbox.id),
    });
    await recordNotifyRunSession(env, inbox, {
      messageId: row.id,
      ok: notify.ok,
      resendId: notify.resendId,
      ...(notify.error ? { error: notify.error } : {}),
    });
  }

  await fireTeamEventForMessage(env, {
    inbox,
    messageId: row.id,
    payload,
  });

  return {
    inboxId: inbox.id,
    messageId: row.id,
    threadId: resolved.threadId,
    address: inbox.address,
    otp: otp || null,
    subject,
    ...(input.scenario ? { scenario: input.scenario } : {}),
    ...(attachmentId ? { attachmentId } : {}),
    ...(callback ? { callback } : {}),
    ...(notify ? { notify } : {}),
  };
}

async function insertSimulatedAttachment(
  env: Env,
  messageId: string,
  filename: string
): Promise<string> {
  const sql = getDb(env);
  const id = nanoid(12);
  const providerId = `sim_att_${nanoid(8)}`;
  await sql`
    INSERT INTO message_attachments (
      id, message_id, provider_id, filename, content_type, size_bytes
    ) VALUES (
      ${id}, ${messageId}, ${providerId}, ${filename},
      ${"application/pdf"}, ${1024}
    )
  `;
  return id;
}

function toNotifyPayload(row: MessageRow, inboxId: string): MessageNotifyPayload {
  const links = parseLinks(row.links_json);
  return {
    id: row.id,
    inboxId: row.inbox_id,
    from: row.from_addr,
    subject: row.subject,
    otp: row.otp,
    links,
    primaryLink: primaryLink(links),
    receivedAt: row.received_at,
    verification: formatMessageVerification(row, inboxId),
  };
}

async function notifyInboxWaiters(
  env: Env,
  inboxId: string,
  payload: MessageNotifyPayload
): Promise<void> {
  const id = env.INBOX_WAIT.idFromName(inboxId);
  const stub = env.INBOX_WAIT.get(id);
  await stub.fetch("http://do/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function parseLinks(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as string[];
    } catch {
      return [];
    }
  }
  return [];
}

import { Hono } from "hono";
import type { Env } from "../env";
import type { ApiVariables } from "../lib/api-context";
import { requireApiKey } from "../lib/auth";
import { rateLimit } from "../lib/rate-limit";
import { parseCallbackUrl } from "../lib/callback-url";
import {
  blockedNotifyDomains,
  parseNotifyEmail,
  parseNotifyMode,
} from "../lib/notify-email";
import { listSimulateScenarios } from "../lib/simulate-scenarios";
import { resolveExpectFrom, resolveTtlMinutes } from "../lib/service-presets";
import {
  scopeInboxDenied,
  scopeLabelForCreate,
  scopeListPrefix,
  scopeWriteDenied,
} from "../lib/scope-guard";
import { listCallbackDeliveries } from "../services/callback-log";
import {
  countNotifyQuotaEvents24h,
  listNotifyDeliveries,
} from "../services/notify-log";
import { getDomainForInbox } from "../services/domains";
import { auditRoute } from "../services/audit-log";
import {
  countActiveInboxesForHint,
  countActiveInboxesForTeam,
  createInbox,
  deleteInbox,
  deleteInboxesByLabelPrefix,
  getInbox,
  getMessage,
  isCreateInboxError,
  listInboxes,
  listMessages,
  type InboxRow,
} from "../services/inbox";
import { rawMessageHttpResponse } from "../services/message-raw";
import {
  attachmentHttpResponse,
  attachmentCountsForMessages,
  formatAttachment,
  listAttachments,
} from "../services/message-attachments";
import { primaryLink } from "../services/extract";
import { extractHtmlActions } from "../services/html-actions";
import {
  buildVerificationMetadata,
  formatMessageVerification,
} from "../services/message-verify";
import { buildInboxDiagnose } from "../services/inbox-diagnose";
import {
  listThreadMessages,
  listThreads,
  sendFromInbox,
} from "../services/outbound-mail";
import { simulateInboundMessage } from "../services/simulate-inbound";
import { buildWaitTimeoutDebug, waitForMessage } from "../services/wait";
import { searchInboxMessages, type SearchMode } from "../services/message-search";
import {
  extractStructuredFromMessage,
  listExtractPresets,
  type ExtractPreset,
} from "../services/structured-extract";
import { publicOriginFromUrl } from "../lib/public-origin";
import { PLAN_LIMITS } from "../lib/plans";
import { MONTHLY_QUOTA_ERROR } from "../services/email-usage";
import { parseRunIdFromLabel } from "../lib/agent-recipes";
import { resolveCleanupPolicy } from "../lib/cleanup-policy";
import {
  recordDiagnoseRunSession,
  recordMessageReceivedRunSession,
  recordWaitStartedRunSession,
  sessionOwnerKey,
} from "../services/agent-run-session";

export const inboxRoutes = new Hono<{ Bindings: Env; Variables: ApiVariables }>();

inboxRoutes.use("*", requireApiKey);
inboxRoutes.use("*", rateLimit);

/** One-shot: create → wait → extract → delete (for agents and CI) */
type CreateBody = {
  ttlMinutes?: number;
  service?: string;
  expectFrom?: string | string[];
  allowedSenders?: string | string[];
  label?: string;
  callbackUrl?: string;
  notifyEmail?: string;
  notifyMode?: string;
  subjectContains?: string;
  messageIndex?: number;
  timeoutSeconds?: number;
  deleteAfter?: boolean;
  deleteAfterSuccess?: boolean;
  deleteAfterMinutes?: number;
  keepOnFailure?: boolean;
  username?: string;
  domainId?: string;
};

inboxRoutes.post("/open", async (c) => {
  const writeErr = scopeWriteDenied(c);
  if (writeErr) return writeErr;

  let body: CreateBody = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const opts = await inboxOptionsFromBody(c, body);
  const clean = rejectInvalidInboxOptions(opts);
  if ("error" in clean) return c.json(clean, 400);
  const cleanup = resolveCleanupPolicy(body, {
    deleteAfterSuccess: true,
    keepOnFailure: false,
  });

  const quotaErr = await checkInboxQuota(c);
  if (quotaErr) return quotaErr;
  const notifyQuotaErr = await checkNotifyQuota(c, clean.notifyEmail);
  if (notifyQuotaErr) return notifyQuotaErr;

  const labelCheck = scopeLabelForCreate(c, clean.label);
  if (labelCheck instanceof Response) return labelCheck;

  const inbox = await createInbox(c.env, {
    ...clean,
    ttlMinutes: cleanup.ttlMinutes ?? clean.ttlMinutes,
    label: labelCheck.label ?? undefined,
    apiKeyHint: c.get("apiKeyHint"),
    teamId: c.get("teamId"),
    username: body.username,
    domainId: body.domainId,
  });
  if (isCreateInboxError(inbox)) {
    return createInboxErrorResponse(c, inbox.error);
  }
  const timeoutSec = Math.min(Number(body.timeoutSeconds ?? 90), 120);
  const messageIndex = Math.max(0, Math.floor(Number(body.messageIndex ?? 0)));
  const waitOpts = {
    subjectContains: body.subjectContains,
    messageIndex,
  };
  const message = await waitForMessage(c.env, inbox.id, timeoutSec, waitOpts);

  if (!message) {
    const debug = await buildWaitTimeoutDebug(c.env, inbox.id, waitOpts);
    const deleteOnFailure = !cleanup.keepOnFailure;
    if (deleteOnFailure) {
      await deleteInbox(c.env, inbox.id, {
        apiKeyHint: c.get("apiKeyHint"),
      });
    }
    return c.json(
      {
        error: "timeout",
        inboxId: inbox.id,
        ...formatInbox(inbox),
        ...debug,
        inboxKept: !deleteOnFailure,
        cleanupPolicy: formatCleanupPolicy(cleanup),
      },
      408
    );
  }

  const verification = formatMessageVerification(message, inbox.id);
  const deleted = cleanup.deleteAfterSuccess;
  if (deleted) {
    await deleteInbox(c.env, inbox.id, { apiKeyHint: c.get("apiKeyHint") });
  }

  return c.json(
    {
      ...formatInbox(inbox),
      inboxId: inbox.id,
      verification,
      deleted,
      cleanupPolicy: formatCleanupPolicy(cleanup),
    },
    201
  );
});

/** QA: list inboxes by label or labelPrefix */
inboxRoutes.get("/", async (c) => {
  const label = c.req.query("label");
  const labelPrefix = scopeListPrefix(c, c.req.query("labelPrefix"));
  if (labelPrefix && labelPrefix.length < 3) {
    return c.json({ error: "labelPrefix_too_short", minLength: 3 }, 400);
  }
  const limit = Number(c.req.query("limit") ?? "20");
  const rows = await listInboxes(c.env, {
    label,
    labelPrefix,
    limit,
    apiKeyHint: c.get("apiKeyHint"),
  });
  return c.json({
    inboxes: rows.map((row) => ({
      ...formatInbox(row),
      id: row.id,
    })),
    ...(labelPrefix ? { labelPrefix } : {}),
  });
});

inboxRoutes.post("/", async (c) => {
  const writeErr = scopeWriteDenied(c);
  if (writeErr) return writeErr;

  let body: CreateBody = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const opts = await inboxOptionsFromBody(c, body);
  const clean = rejectInvalidInboxOptions(opts);
  if ("error" in clean) return c.json(clean, 400);

  const quotaErr = await checkInboxQuota(c);
  if (quotaErr) return quotaErr;
  const notifyQuotaErr = await checkNotifyQuota(c, clean.notifyEmail);
  if (notifyQuotaErr) return notifyQuotaErr;

  const labelCheck = scopeLabelForCreate(c, clean.label);
  if (labelCheck instanceof Response) return labelCheck;

  const inbox = await createInbox(c.env, {
    ...clean,
    label: labelCheck.label ?? undefined,
    apiKeyHint: c.get("apiKeyHint"),
    teamId: c.get("teamId"),
    username: body.username,
    domainId: body.domainId,
  });
  if (isCreateInboxError(inbox)) {
    return createInboxErrorResponse(c, inbox.error);
  }
  auditRoute(c, {
      action: "inbox.created",
      resourceType: "inbox",
      resourceId: inbox.id,
      meta: { address: inbox.address, label: inbox.label ?? null },
    });
  return c.json({ id: inbox.id, ...formatInbox(inbox) }, 201);
});

/** QA: bulk delete by label prefix (after nightly / suite) */
inboxRoutes.delete("/", async (c) => {
  const writeErr = scopeWriteDenied(c);
  if (writeErr) return writeErr;

  const labelPrefix = scopeListPrefix(c, c.req.query("labelPrefix"));
  if (!labelPrefix) {
    return c.json({ error: "labelPrefix_required" }, 400);
  }
  if (labelPrefix.length < 3) {
    return c.json({ error: "labelPrefix_too_short", minLength: 3 }, 400);
  }

  const ids = await deleteInboxesByLabelPrefix(
    c.env,
    labelPrefix,
    c.get("apiKeyHint")
  );
  auditRoute(c, {
      action: "inbox.bulk_deleted",
      resourceType: "inbox",
      meta: { labelPrefix, count: ids.length },
    });
  return c.json({ deleted: ids.length, ids });
});

/** QA: list simulate scenario fixtures */
inboxRoutes.get("/simulate/scenarios", (c) => {
  return c.json({ scenarios: listSimulateScenarios() });
});

inboxRoutes.get("/:id", async (c) => {
  const inbox = await getInbox(c.env, c.req.param("id"), {
    apiKeyHint: c.get("apiKeyHint"),
  });
  if (!inbox) return c.json({ error: "inbox_not_found" }, 404);
  const denied = scopeInboxDenied(c, inbox);
  if (denied) return denied;
  const messages = await listMessages(c.env, inbox.id);
  return c.json({
    ...formatInbox(inbox),
    id: inbox.id,
    messageCount: messages.length,
  });
});

/** QA/dev: inject test OTP email without Resend (write scope required) */
inboxRoutes.post("/:id/simulate", async (c) => {
  const writeErr = scopeWriteDenied(c);
  if (writeErr) return writeErr;

  const inbox = await getInbox(c.env, c.req.param("id"), {
    apiKeyHint: c.get("apiKeyHint"),
  });
  if (!inbox) return c.json({ error: "inbox_not_found" }, 404);
  const denied = scopeInboxDenied(c, inbox);
  if (denied) return denied;

  let body: {
    scenario?: string;
    otp?: string;
    from?: string;
    subject?: string;
    fireCallback?: boolean;
    attachmentFilename?: string;
    inReplyToMessageId?: string;
    rfcMessageId?: string;
    inReplyTo?: string;
    references?: string;
    headers?: Record<string, string | string[] | undefined>;
  } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const result = await simulateInboundMessage(c.env, {
    inboxId: inbox.id,
    apiKeyHint: c.get("apiKeyHint"),
    scenario: body.scenario,
    otp: body.otp,
    from: body.from,
    subject: body.subject,
    fireCallback: body.fireCallback === true,
    attachmentFilename: body.attachmentFilename,
    inReplyToMessageId: body.inReplyToMessageId,
    rfcMessageId: body.rfcMessageId,
    inReplyTo: body.inReplyTo,
    references: body.references,
    headers: body.headers,
  });
  if (!result) return c.json({ error: "simulate_failed" }, 500);

  return c.json(result, 201);
});

/** Outbound: send email from inbox (AgentMail parity) */
inboxRoutes.post("/:id/send", async (c) => {
  const writeErr = scopeWriteDenied(c);
  if (writeErr) return writeErr;

  const inbox = await getInbox(c.env, c.req.param("id"), {
    apiKeyHint: c.get("apiKeyHint"),
  });
  if (!inbox) return c.json({ error: "inbox_not_found" }, 404);
  const denied = scopeInboxDenied(c, inbox);
  if (denied) return denied;

  let body: {
    to?: string | string[];
    cc?: string[];
    bcc?: string[];
    subject?: string;
    text?: string;
    html?: string;
    inReplyToMessageId?: string;
  } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  const toRaw = body.to;
  const to = Array.isArray(toRaw)
    ? toRaw
    : typeof toRaw === "string"
      ? [toRaw]
      : [];
  if (!to.length || !body.subject?.trim()) {
    return c.json({ error: "to_and_subject_required" }, 400);
  }

  try {
    const result = await sendFromInbox(c.env, {
      inboxId: inbox.id,
      apiKeyHint: c.get("apiKeyHint"),
      teamId: c.get("teamId"),
      to,
      cc: body.cc,
      bcc: body.bcc,
      subject: body.subject.trim(),
      text: body.text,
      html: body.html,
      inReplyToMessageId: body.inReplyToMessageId,
    });
    if (!result) return c.json({ error: "send_failed" }, 500);
    auditRoute(c, {
        action: "inbox.sent",
        resourceType: "message",
        resourceId: result.messageId,
        meta: { inboxId: inbox.id, to, subject: result.subject },
      });
    return c.json(result, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "send_failed";
    if (msg.startsWith(MONTHLY_QUOTA_ERROR)) {
      return c.json({ error: MONTHLY_QUOTA_ERROR, message: msg }, 429);
    }
    const status = msg.startsWith("dedicated_outbound_requires_custom_domain_inbox")
      ? 403
      : 502;
    return c.json({ error: "send_failed", message: msg }, status);
  }
});

inboxRoutes.post("/:id/messages/:messageId/reply", async (c) => {
  const writeErr = scopeWriteDenied(c);
  if (writeErr) return writeErr;

  const inbox = await getInbox(c.env, c.req.param("id"), {
    apiKeyHint: c.get("apiKeyHint"),
  });
  if (!inbox) return c.json({ error: "inbox_not_found" }, 404);
  const denied = scopeInboxDenied(c, inbox);
  if (denied) return denied;

  const parent = await getMessage(c.env, inbox.id, c.req.param("messageId"));
  if (!parent) return c.json({ error: "message_not_found" }, 404);

  let body: { to?: string | string[]; text?: string; html?: string; subject?: string } =
    {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const to = Array.isArray(body.to)
    ? body.to
    : typeof body.to === "string"
      ? [body.to]
      : [parent.from_addr];
  const subject =
    body.subject?.trim() ||
    (parent.subject.match(/^re:/i) ? parent.subject : `Re: ${parent.subject}`);

  try {
    const result = await sendFromInbox(c.env, {
      inboxId: inbox.id,
      apiKeyHint: c.get("apiKeyHint"),
      teamId: c.get("teamId"),
      to,
      subject,
      text: body.text,
      html: body.html,
      inReplyToMessageId: parent.id,
    });
    if (!result) return c.json({ error: "send_failed" }, 500);
    auditRoute(c, {
        action: "inbox.replied",
        resourceType: "message",
        resourceId: result.messageId,
        meta: {
          inboxId: inbox.id,
          inReplyTo: parent.id,
          to,
          subject: result.subject,
        },
      });
    return c.json(result, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "send_failed";
    if (msg.startsWith(MONTHLY_QUOTA_ERROR)) {
      return c.json({ error: MONTHLY_QUOTA_ERROR, message: msg }, 429);
    }
    const status = msg.startsWith("dedicated_outbound_requires_custom_domain_inbox")
      ? 403
      : 502;
    return c.json({ error: "send_failed", message: msg }, status);
  }
});

inboxRoutes.get("/:id/threads", async (c) => {
  const inbox = await getInbox(c.env, c.req.param("id"), {
    apiKeyHint: c.get("apiKeyHint"),
  });
  if (!inbox) return c.json({ error: "inbox_not_found" }, 404);
  const denied = scopeInboxDenied(c, inbox);
  if (denied) return denied;

  const threads = await listThreads(c.env, inbox.id);
  return c.json({ threads });
});

inboxRoutes.get("/:id/threads/:threadId/messages", async (c) => {
  const inbox = await getInbox(c.env, c.req.param("id"), {
    apiKeyHint: c.get("apiKeyHint"),
  });
  if (!inbox) return c.json({ error: "inbox_not_found" }, 404);
  const denied = scopeInboxDenied(c, inbox);
  if (denied) return denied;

  const messages = await listThreadMessages(
    c.env,
    inbox.id,
    c.req.param("threadId")
  );
  return c.json({
    threadId: c.req.param("threadId"),
    messages: messages.map(formatThreadMessage),
  });
});

/** Search messages: keyword + optional semantic (Workers AI) */
inboxRoutes.get("/:id/search", async (c) => {
  const inbox = await getInbox(c.env, c.req.param("id"), {
    apiKeyHint: c.get("apiKeyHint"),
  });
  if (!inbox) return c.json({ error: "inbox_not_found" }, 404);
  const denied = scopeInboxDenied(c, inbox);
  if (denied) return denied;

  const q = c.req.query("q") ?? "";
  if (!q.trim()) return c.json({ error: "q_required" }, 400);

  const limit = Number(c.req.query("limit") ?? "10");
  const modeRaw = c.req.query("mode") ?? "auto";
  const mode: SearchMode =
    modeRaw === "keyword" || modeRaw === "semantic" ? modeRaw : "auto";

  const result = await searchInboxMessages(c.env, inbox.id, q, {
    limit,
    mode,
  });
  return c.json(result);
});

inboxRoutes.get("/:id/diagnose", async (c) => {
  const inbox = await getInbox(c.env, c.req.param("id"), {
    apiKeyHint: c.get("apiKeyHint"),
  });
  if (!inbox) return c.json({ error: "inbox_not_found" }, 404);
  const denied = scopeInboxDenied(c, inbox);
  if (denied) return denied;

  const subjectContains = c.req.query("subjectContains") ?? undefined;
  const messageIndex = Math.max(
    0,
    Math.floor(Number(c.req.query("messageIndex") ?? 0))
  );
  const apiBase = publicOriginFromUrl(c.req.url, c.env.MAILAGENT_PUBLIC_API_ORIGIN);

  const diagnose = await buildInboxDiagnose(c.env, inbox.id, {
    subjectContains,
    messageIndex,
    apiBaseUrl: apiBase,
    apiKeyHint: c.get("apiKeyHint"),
  });
  if (!diagnose) return c.json({ error: "inbox_not_found" }, 404);
  await recordDiagnoseRunSession(c.env, inbox, {
    failureCode: diagnose.failureSummary.code,
    recommendedAction: diagnose.recommendedAction.type,
    messageCount: diagnose.messageCount,
    ...(subjectContains ? { subjectContains } : {}),
    messageIndex,
  });

  return c.json(diagnose);
});

inboxRoutes.get("/:id/notify-deliveries", async (c) => {
  const inbox = await getInbox(c.env, c.req.param("id"), {
    apiKeyHint: c.get("apiKeyHint"),
  });
  if (!inbox) return c.json({ error: "inbox_not_found" }, 404);
  const denied = scopeInboxDenied(c, inbox);
  if (denied) return denied;
  const limit = Number(c.req.query("limit") ?? "20");
  const rows = await listNotifyDeliveries(c.env, inbox.id, limit);
  return c.json({
    deliveries: rows.map((row) => ({
      id: row.id,
      notifyEmail: row.notify_email,
      messageId: row.message_id,
      resendId: row.resend_id,
      ok: row.ok,
      error: row.error_text,
      durationMs: row.duration_ms,
      createdAt: row.created_at,
    })),
  });
});

inboxRoutes.get("/:id/callbacks", async (c) => {
  const inbox = await getInbox(c.env, c.req.param("id"), {
    apiKeyHint: c.get("apiKeyHint"),
  });
  if (!inbox) return c.json({ error: "inbox_not_found" }, 404);
  const denied = scopeInboxDenied(c, inbox);
  if (denied) return denied;
  const limit = Number(c.req.query("limit") ?? "20");
  const rows = await listCallbackDeliveries(c.env, inbox.id, limit);
  return c.json({
    deliveries: rows.map((row) => ({
      id: row.id,
      callbackUrl: row.callback_url,
      messageId: row.message_id,
      statusCode: row.status_code,
      ok: row.ok,
      error: row.error_text,
      durationMs: row.duration_ms,
      createdAt: row.created_at,
    })),
  });
});

inboxRoutes.get("/:id/messages/:messageId/attachments", async (c) => {
  const inbox = await getInbox(c.env, c.req.param("id"), {
    apiKeyHint: c.get("apiKeyHint"),
  });
  if (!inbox) return c.json({ error: "inbox_not_found" }, 404);
  const denied = scopeInboxDenied(c, inbox);
  if (denied) return denied;

  const message = await getMessage(c.env, inbox.id, c.req.param("messageId"));
  if (!message) return c.json({ error: "message_not_found" }, 404);

  const rows = await listAttachments(c.env, message.id);
  return c.json({
    messageId: message.id,
    attachments: rows.map((r) =>
      formatAttachment(r, inbox.id, message.id)
    ),
  });
});

inboxRoutes.get("/:id/messages/:messageId/attachments/:attachmentId", async (c) => {
  const inbox = await getInbox(c.env, c.req.param("id"), {
    apiKeyHint: c.get("apiKeyHint"),
  });
  if (!inbox) return c.json({ error: "inbox_not_found" }, 404);
  const denied = scopeInboxDenied(c, inbox);
  if (denied) return denied;

  const accept = c.req.header("Accept") ?? "";
  return attachmentHttpResponse(
    c.env,
    inbox.id,
    c.req.param("messageId"),
    c.req.param("attachmentId"),
    accept.includes("application/json")
  );
});

inboxRoutes.get("/:id/messages/:messageId/raw", async (c) => {
  const inbox = await getInbox(c.env, c.req.param("id"), {
    apiKeyHint: c.get("apiKeyHint"),
  });
  if (!inbox) return c.json({ error: "inbox_not_found" }, 404);
  const denied = scopeInboxDenied(c, inbox);
  if (denied) return denied;

  const accept = c.req.header("Accept") ?? "";
  return rawMessageHttpResponse(
    c.env,
    inbox.id,
    c.req.param("messageId"),
    accept.includes("application/json")
  );
});

inboxRoutes.get("/:id/messages", async (c) => {
  const inbox = await getInbox(c.env, c.req.param("id"), {
    apiKeyHint: c.get("apiKeyHint"),
  });
  if (!inbox) return c.json({ error: "inbox_not_found" }, 404);
  const denied = scopeInboxDenied(c, inbox);
  if (denied) return denied;
  const subjectContains = c.req.query("subjectContains") ?? undefined;
  const messages = await listMessages(c.env, inbox.id, { subjectContains });
  const attCounts = await attachmentCountsForMessages(
    c.env,
    messages.map((m) => m.id)
  );
  return c.json({
    messages: messages.map((m) => ({
      ...formatMessage(m),
      attachmentCount: attCounts[m.id] ?? 0,
      ...(m.raw_r2_key
        ? { rawUrl: `/v1/inboxes/${inbox.id}/messages/${m.id}/raw` }
        : {}),
    })),
    ...(subjectContains ? { subjectContains } : {}),
  });
});

/** Presets for structured extraction (before GET …/extract) */
inboxRoutes.get("/:id/extract/presets", async (c) => {
  const inbox = await getInbox(c.env, c.req.param("id"), {
    apiKeyHint: c.get("apiKeyHint"),
  });
  if (!inbox) return c.json({ error: "inbox_not_found" }, 404);
  const denied = scopeInboxDenied(c, inbox);
  if (denied) return denied;
  return c.json({ presets: listExtractPresets() });
});

inboxRoutes.get("/:id/extract", async (c) => {
  const inbox = await getInbox(c.env, c.req.param("id"), {
    apiKeyHint: c.get("apiKeyHint"),
  });
  if (!inbox) return c.json({ error: "inbox_not_found" }, 404);
  const denied = scopeInboxDenied(c, inbox);
  if (denied) return denied;
  const messages = await listMessages(c.env, inbox.id);
  const latest = messages[0];
  if (!latest) return c.json({ error: "no_messages" }, 404);
  return c.json(formatMessageVerification(latest, inbox.id));
});

/** Structured JSON extraction from a message (presets or custom schema + AI) */
inboxRoutes.post("/:id/messages/:messageId/extract", async (c) => {
  const inbox = await getInbox(c.env, c.req.param("id"), {
    apiKeyHint: c.get("apiKeyHint"),
  });
  if (!inbox) return c.json({ error: "inbox_not_found" }, 404);
  const denied = scopeInboxDenied(c, inbox);
  if (denied) return denied;

  let body: { preset?: string; schema?: Record<string, unknown> } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const message = await getMessage(
    c.env,
    inbox.id,
    c.req.param("messageId")
  );
  if (!message) return c.json({ error: "message_not_found" }, 404);

  const preset = body.preset as ExtractPreset | undefined;
  const result = await extractStructuredFromMessage(c.env, message, {
    preset,
    schema: body.schema,
  });

  if ("error" in result) {
    const status =
      result.error === "ai_required_for_custom_schema"
        ? 501
        : result.error === "ai_extract_failed"
          ? 502
          : 400;
    return c.json({ error: result.error }, status);
  }

  return c.json(result);
});

/** SSE: wait for first message (more reliable than 120s long-poll on Workers) */
inboxRoutes.get("/:id/events", async (c) => {
  const inbox = await getInbox(c.env, c.req.param("id"), {
    apiKeyHint: c.get("apiKeyHint"),
  });
  if (!inbox) return c.json({ error: "inbox_not_found" }, 404);
  const denied = scopeInboxDenied(c, inbox);
  if (denied) return denied;

  const id = c.env.INBOX_WAIT.idFromName(inbox.id);
  const stub = c.env.INBOX_WAIT.get(id);
  return stub.fetch("http://do/subscribe", { method: "GET" });
});

/** Fallback poll: ?timeout=60, interval 2s */
inboxRoutes.get("/:id/wait", async (c) => {
  const inbox = await getInbox(c.env, c.req.param("id"), {
    apiKeyHint: c.get("apiKeyHint"),
  });
  if (!inbox) return c.json({ error: "inbox_not_found" }, 404);
  const denied = scopeInboxDenied(c, inbox);
  if (denied) return denied;

  const timeoutSec = Math.min(Number(c.req.query("timeout") ?? 60), 120);
  const subjectContains = c.req.query("subjectContains") ?? undefined;
  const messageIndex = Math.max(
    0,
    Math.floor(Number(c.req.query("messageIndex") ?? 0))
  );
  const waitOpts = { subjectContains, messageIndex };
  const runId = parseRunIdFromLabel(inbox.label);
  const ownerKey = sessionOwnerKey(c.get("teamId"), c.get("apiKeyHint"));
  await recordWaitStartedRunSession(c.env, runId ?? undefined, ownerKey, {
    inboxId: inbox.id,
    timeoutSeconds: timeoutSec,
    ...(subjectContains ? { subjectContains } : {}),
    messageIndex,
  });
  const message = await waitForMessage(c.env, inbox.id, timeoutSec, waitOpts);
  if (!message) {
    const debug = await buildWaitTimeoutDebug(c.env, inbox.id, waitOpts);
    return c.json({ error: "timeout", inboxId: inbox.id, ...debug }, 408);
  }
  await recordMessageReceivedRunSession(c.env, runId ?? undefined, ownerKey, {
    inboxId: inbox.id,
    messageId: message.id,
    from: message.from_addr,
    subject: message.subject,
    receivedAt: message.received_at,
  });
  return c.json({
    message: {
      ...formatMessage(message),
      ...(message.raw_r2_key
        ? { rawUrl: `/v1/inboxes/${inbox.id}/messages/${message.id}/raw` }
        : {}),
    },
  });
});

inboxRoutes.delete("/:id", async (c) => {
  const writeErr = scopeWriteDenied(c);
  if (writeErr) return writeErr;

  const inbox = await getInbox(c.env, c.req.param("id"), {
    apiKeyHint: c.get("apiKeyHint"),
  });
  if (!inbox) return c.json({ error: "inbox_not_found" }, 404);
  const denied = scopeInboxDenied(c, inbox);
  if (denied) return denied;

  const ok = await deleteInbox(c.env, c.req.param("id"), {
    apiKeyHint: c.get("apiKeyHint"),
  });
  if (!ok) return c.json({ error: "inbox_not_found" }, 404);
  return c.json({ deleted: true });
});

function formatThreadMessage(m: {
  id: string;
  from_addr: string;
  subject: string;
  text_preview: string | null;
  html_preview?: string | null;
  otp: string | null;
  links_json: unknown;
  received_at: string;
  raw_r2_key?: string | null;
  direction?: string;
  thread_id?: string | null;
  in_reply_to?: string | null;
  to_addrs?: unknown;
}) {
  const base = formatMessage(m);
  const toAddrs = Array.isArray(m.to_addrs) ? (m.to_addrs as string[]) : [];
  return {
    ...base,
    htmlPreview: m.html_preview,
    direction: m.direction === "outbound" ? "outbound" : "inbound",
    threadId: m.thread_id,
    inReplyTo: m.in_reply_to,
    to: toAddrs,
  };
}

function formatMessage(m: {
  id: string;
  from_addr: string;
  subject: string;
  text_preview: string | null;
  html_preview?: string | null;
  otp: string | null;
  links_json: unknown;
  received_at: string;
  raw_r2_key?: string | null;
}) {
  const links = parseLinks(m.links_json);
  const primary = primaryLink(links);
  const actions = extractHtmlActions({
    html: m.html_preview,
    text: m.text_preview,
    links,
  });
  return {
    id: m.id,
    from: m.from_addr,
    subject: m.subject,
    textPreview: m.text_preview,
    otp: m.otp,
    links,
    primaryLink: primary,
    ...actions,
    ...buildVerificationMetadata(m.otp, links, primary),
    receivedAt: m.received_at,
    hasRaw: Boolean(m.raw_r2_key),
  };
}

async function inboxOptionsFromBody(
  c: import("hono").Context<{ Bindings: Env; Variables: ApiVariables }>,
  body: CreateBody
) {
  const expectFrom = resolveExpectFrom(body.service, body.expectFrom);
  const callbackUrl = parseCallbackUrl(body.callbackUrl);

  let customDomain: string | undefined;
  if (body.domainId) {
    const domain = await getDomainForInbox(c.env, body.domainId, {
      teamId: c.get("teamId"),
      apiKeyHint: c.get("apiKeyHint"),
    });
    customDomain = domain?.name;
  }
  const notifyEmail = parseNotifyEmail(body.notifyEmail, {
    blockedDomains: blockedNotifyDomains(c.env.INBOX_DOMAIN, customDomain),
  });

  return {
    ttlMinutes: resolveTtlMinutes(
      body.service,
      body.deleteAfterMinutes ?? body.ttlMinutes
    ),
    expectFrom,
    allowedSenders: body.allowedSenders,
    label: body.label,
    callbackUrl,
    callbackInvalid: Boolean(body.callbackUrl && !callbackUrl),
    notifyEmail,
    notifyMode: notifyEmail ? parseNotifyMode(body.notifyMode) : "off",
    notifyInvalid: Boolean(body.notifyEmail && !notifyEmail),
    username: body.username,
    domainId: body.domainId,
  };
}

function formatCleanupPolicy(
  cleanup: ReturnType<typeof resolveCleanupPolicy>
) {
  return {
    deleteAfterSuccess: cleanup.deleteAfterSuccess,
    keepOnFailure: cleanup.keepOnFailure,
    ...(cleanup.deleteAfterMinutes !== undefined
      ? { deleteAfterMinutes: cleanup.deleteAfterMinutes }
      : {}),
  };
}

function rejectInvalidInboxOptions(
  opts: Awaited<ReturnType<typeof inboxOptionsFromBody>>
) {
  if (opts.callbackInvalid) {
    return { error: "invalid_callback_url" as const };
  }
  if (opts.notifyInvalid) {
    return { error: "invalid_notify_email" as const };
  }
  const { callbackInvalid: _c, notifyInvalid: _n, ...rest } = opts;
  return rest;
}

function formatInbox(inbox: InboxRow) {
  return {
    address: inbox.address,
    expiresAt: inbox.expires_at,
    createdAt: inbox.created_at,
    allowedSenders: inbox.allowed_senders,
    label: inbox.label,
    callbackUrl: inbox.callback_url,
    notifyEmail: inbox.notify_email,
    notifyMode: inbox.notify_mode,
    ...(inbox.domain_id ? { domainId: inbox.domain_id } : {}),
  };
}

function createInboxErrorResponse(
  c: import("hono").Context<{ Bindings: Env; Variables: ApiVariables }>,
  error: "domain_not_found" | "domain_not_verified" | "username_requires_domain"
) {
  const status =
    error === "domain_not_found"
      ? 404
      : error === "domain_not_verified"
        ? 400
        : 400;
  const hints: Record<string, string> = {
    domain_not_verified:
      "Add DNS records from POST /v1/domains, then POST /v1/domains/:id/verify",
    username_requires_domain: "Pass domainId when using username",
  };
  return c.json({ error, ...(hints[error] ? { hint: hints[error] } : {}) }, status);
}

async function checkInboxQuota(
  c: import("hono").Context<{ Bindings: Env; Variables: ApiVariables }>
) {
  const teamId = c.get("teamId");
  const active = teamId
    ? await countActiveInboxesForTeam(c.env, teamId)
    : await countActiveInboxesForHint(c.env, c.get("apiKeyHint"));
  const max = c.get("maxActiveInboxes");
  if (active >= max) {
    return c.json(
      {
        error: "inbox_limit_reached",
        plan: c.get("apiPlan"),
        active,
        max,
      },
      429
    );
  }
  return null;
}

async function checkNotifyQuota(
  c: import("hono").Context<{ Bindings: Env; Variables: ApiVariables }>,
  notifyEmail: string | null | undefined
) {
  if (!notifyEmail) return null;
  const teamId = c.get("teamId");
  const apiKeyHint = c.get("apiKeyHint");
  const used = await countNotifyQuotaEvents24h(c.env, { teamId, apiKeyHint });
  const plan = c.get("apiPlan");
  const limit = PLAN_LIMITS[plan].notifyEmailsPerDay;
  if (used >= limit) {
    return c.json(
      {
        error: "notify_quota_exceeded",
        plan,
        used,
        limit,
      },
      429
    );
  }
  return null;
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

/** Agent verify: inbox → wait → extract + primaryAction for LLM */
import type { Env } from "../env";
import { publicApiOrigin } from "../lib/public-origin";
import { parseCallbackUrl } from "../lib/callback-url";
import { buildPrimaryAction, resolveAgentLabel } from "../lib/agent-recipes";
import { debugUiUrl } from "./inbox-diagnose";
import {
  resolveExpectFrom,
  resolveSubjectHint,
  resolveTtlMinutes,
} from "../lib/service-presets";
import { countAttachmentsForMessage } from "./message-attachments";
import {
  createInbox,
  deleteInbox,
  getInbox,
  type InboxRow,
} from "./inbox";
import { formatMessageVerification } from "./message-verify";
import {
  buildWaitTimeoutDebug,
  waitForMessage,
  type WaitProgressEvent,
} from "./wait";
import {
  recordVerifyRunSession,
  sessionOwnerKey,
  getAgentRunSession,
  recordInboxRunSession,
  recordMessageReceivedRunSession,
  recordWaitStartedRunSession,
  type AgentRunSession,
} from "./agent-run-session";
import { validateRunId } from "../lib/validate-run-id";
import { resolveCleanupPolicy } from "../lib/cleanup-policy";

export type VerifyInput = {
  inboxId?: string;
  ttlMinutes?: number;
  service?: string;
  /** signup (default) | login | password_reset — default subjectContains per service */
  flow?: string;
  expectFrom?: string | string[];
  allowedSenders?: string | string[];
  label?: string;
  callbackUrl?: string;
  subjectContains?: string;
  messageIndex?: number;
  timeoutSeconds?: number;
  deleteAfter?: boolean;
  deleteAfterSuccess?: boolean;
  deleteAfterMinutes?: number;
  keepOnFailure?: boolean;
  runId?: string;
  apiKeyHint: string;
  teamId?: string | null;
  username?: string;
  domainId?: string;
  onProgress?: (event: WaitProgressEvent) => void;
  apiBaseUrl?: string;
};

async function attachRunSession<T extends Record<string, unknown>>(
  env: Env,
  input: VerifyInput,
  result: T
): Promise<T & { session?: AgentRunSession }> {
  if (!input.runId || !validateRunId(input.runId)) return result;
  const session = await getAgentRunSession(
    env,
    input.runId,
    sessionOwnerKey(input.teamId, input.apiKeyHint)
  );
  return session ? { ...result, session } : result;
}

export async function runAgentVerify(env: Env, input: VerifyInput) {
  const callbackUrl = parseCallbackUrl(input.callbackUrl);
  if (input.callbackUrl && !callbackUrl) {
    return { error: "invalid_callback_url" as const, status: 400 as const };
  }

  const expectFrom = resolveExpectFrom(input.service, input.expectFrom);
  const cleanup = resolveCleanupPolicy(input, {
    deleteAfterSuccess: true,
    keepOnFailure: false,
  });
  const label = resolveAgentLabel({
    label: input.label,
    runId: input.runId,
  });
  let inbox: InboxRow;
  let createdInbox = false;

  if (input.inboxId) {
    const existing = await getInbox(env, input.inboxId, {
      apiKeyHint: input.apiKeyHint,
    });
    if (!existing) {
      return { error: "inbox_not_found" as const, status: 404 as const };
    }
    inbox = existing;
  } else {
    const created = await createInbox(env, {
      ttlMinutes:
        cleanup.ttlMinutes ?? resolveTtlMinutes(input.service, input.ttlMinutes),
      expectFrom,
      allowedSenders: input.allowedSenders,
      label,
      callbackUrl,
      apiKeyHint: input.apiKeyHint,
      teamId: input.teamId ?? null,
      username: input.username,
      domainId: input.domainId,
    });
    if ("error" in created) {
      return { error: created.error, status: 400 as const };
    }
    inbox = created;
    createdInbox = true;
    await recordInboxRunSession(
      env,
      input.runId,
      sessionOwnerKey(input.teamId, input.apiKeyHint),
      { id: inbox.id, address: inbox.address }
    );
  }

  const timeoutSec = Math.min(Number(input.timeoutSeconds ?? 90), 120);
  const messageIndex = Math.max(0, Math.floor(Number(input.messageIndex ?? 0)));
  const subjectContains =
    input.subjectContains?.trim() ||
    resolveSubjectHint(input.service, input.flow);
  const waitOpts = {
    subjectContains,
    messageIndex,
    onProgress: input.onProgress,
  };
  await recordWaitStartedRunSession(
    env,
    input.runId,
    sessionOwnerKey(input.teamId, input.apiKeyHint),
    {
      inboxId: inbox.id,
      timeoutSeconds: timeoutSec,
      ...(subjectContains ? { subjectContains } : {}),
      messageIndex,
    }
  );
  const message = await waitForMessage(env, inbox.id, timeoutSec, waitOpts);

  if (!message) {
    const deleteOnFailure = !cleanup.keepOnFailure && !input.inboxId;
    if (deleteOnFailure) {
      await deleteInbox(env, inbox.id, { apiKeyHint: input.apiKeyHint });
    }
    const debug = await buildWaitTimeoutDebug(env, inbox.id, waitOpts);
    const apiBase = input.apiBaseUrl ?? publicApiOrigin(env.MAILAGENT_PUBLIC_API_ORIGIN);
    const timeoutResult = {
      status: "timeout" as const,
      statusCode: 408 as const,
      email: formatEmail(inbox),
      ...debug,
      debugUiUrl: debugUiUrl(apiBase, inbox.id),
      suggestedSubjectContains:
        resolveSubjectHint(input.service, input.flow) ?? null,
      inboxKept: !deleteOnFailure,
      cleanupPolicy: formatCleanupPolicy(cleanup),
      ...(createdInbox ? { createdInbox: true } : {}),
    };
    await recordVerifyRunSession(
      env,
      input.runId,
      sessionOwnerKey(input.teamId, input.apiKeyHint),
      input.service,
      { status: "timeout", email: { inboxId: inbox.id } }
    );
    return await attachRunSession(env, input, timeoutResult);
  }

  await recordMessageReceivedRunSession(
    env,
    input.runId,
    sessionOwnerKey(input.teamId, input.apiKeyHint),
    {
      inboxId: inbox.id,
      messageId: message.id,
      from: message.from_addr,
      subject: message.subject,
      receivedAt: message.received_at,
    }
  );

  const attachmentCount = await countAttachmentsForMessage(env, message.id);
  const verification = {
    ...formatMessageVerification(message, inbox.id),
    attachmentCount,
    hasAttachments: attachmentCount > 0,
  };

  const deleted =
    cleanup.deleteAfterSuccess &&
    (!input.inboxId ||
      input.deleteAfterSuccess === true ||
      input.deleteAfter === true);
  if (deleted) {
    await deleteInbox(env, inbox.id, { apiKeyHint: input.apiKeyHint });
  }

  const verifiedResult = {
    status: "verified" as const,
    statusCode: 200 as const,
    email: formatEmail(inbox),
    verification,
    agent: {
      primaryAction: buildPrimaryAction(verification),
      service: input.service ?? null,
    },
    deleted,
    cleanupPolicy: formatCleanupPolicy(cleanup),
  };
  await recordVerifyRunSession(
    env,
    input.runId,
    sessionOwnerKey(input.teamId, input.apiKeyHint),
    input.service,
    {
      status: "verified",
      email: { inboxId: inbox.id },
      verification: {
        otp: verification.otp ?? null,
        primaryLink: verification.primaryLink ?? null,
      },
    }
  );
  return await attachRunSession(env, input, verifiedResult);
}

function formatCleanupPolicy(cleanup: ReturnType<typeof resolveCleanupPolicy>) {
  return {
    deleteAfterSuccess: cleanup.deleteAfterSuccess,
    keepOnFailure: cleanup.keepOnFailure,
    ...(cleanup.deleteAfterMinutes !== undefined
      ? { deleteAfterMinutes: cleanup.deleteAfterMinutes }
      : {}),
  };
}

function formatEmail(inbox: InboxRow) {
  return {
    inboxId: inbox.id,
    address: inbox.address,
    expiresAt: inbox.expires_at,
    allowedSenders: inbox.allowed_senders,
    label: inbox.label,
  };
}

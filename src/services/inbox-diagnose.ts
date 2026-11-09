/** Diagnose inbox — messages, callbacks, troubleshooting (QA + agents) */
import type { Env } from "../env";
import { listCallbackDeliveries } from "./callback-log";
import { getInbox, listMessages } from "./inbox";
import { primaryLink } from "./extract";
import { buildWaitTimeoutDebug } from "./wait";
import {
  LEGACY_API_ORIGIN,
  LEGACY_WORKSPACE_ORIGIN,
  NAVORINA_API_ORIGIN,
  NAVORINA_WORKSPACE_ORIGIN,
} from "../lib/public-origin";

export type InboxDiagnoseOptions = {
  subjectContains?: string;
  messageIndex?: number;
  apiBaseUrl: string;
  apiKeyHint?: string;
};

export type DiagnoseFailureCode =
  | "no_messages"
  | "monthly_quota_exceeded"
  | "subject_filter_no_match"
  | "message_index_too_high"
  | "callback_failed"
  | "message_received"
  | "unknown";

export type DiagnoseNextActionType =
  | "wait"
  | "adjust_subject_filter"
  | "adjust_message_index"
  | "fix_callback"
  | "extract_verification"
  | "simulate_message"
  | "open_debug_ui";

export type DiagnoseAction = {
  type: DiagnoseNextActionType;
  confidence: "high" | "medium" | "low";
  reason: string;
  label: string;
  href?: string;
  payload?: Record<string, unknown>;
};

export type InboxDiagnoseResult = {
  inboxId: string;
  address: string;
  label: string | null;
  expiresAt: string;
  callbackUrl: string | null;
  messageCount: number;
  messages: Array<{
    id: string;
    from: string;
    subject: string;
    otp: string | null;
    primaryLink: string | null;
    receivedAt: string;
    hasRaw: boolean;
    rawUrl?: string;
    attachmentCount?: number;
  }>;
  callbacks: Array<{
    id: string;
    callbackUrl: string;
    messageId: string | null;
    statusCode: number | null;
    ok: boolean;
    error: string | null;
    durationMs: number | null;
    createdAt: string;
  }>;
  waitDebug: Awaited<ReturnType<typeof buildWaitTimeoutDebug>>;
  troubleshooting: string[];
  failureSummary: {
    code: DiagnoseFailureCode;
    message: string;
    confidence: "high" | "medium" | "low";
  };
  recommendedAction: DiagnoseAction;
  retry: {
    keepInbox: boolean;
    wait: {
      method: "GET";
      path: string;
      query: {
        timeoutSeconds: number;
        subjectContains?: string;
        messageIndex: number;
      };
    };
    simulate: {
      method: "POST";
      path: string;
      body: {
        subject: string;
        otp: string;
      };
    };
  };
  nextActions: DiagnoseAction[];
  debugUiUrl: string;
  apiMessagesUrl: string;
};

export async function buildInboxDiagnose(
  env: Env,
  inboxId: string,
  options: InboxDiagnoseOptions
): Promise<InboxDiagnoseResult | null> {
  const inbox = await getInbox(env, inboxId, {
    apiKeyHint: options.apiKeyHint,
  });
  if (!inbox) return null;

  const subjectContains = options.subjectContains?.trim();
  const messageIndex = Math.max(0, Math.floor(options.messageIndex ?? 0));
  const waitOpts = { subjectContains, messageIndex };

  const [allMessages, filteredMessages, callbacks, waitDebug] = await Promise.all([
    listMessages(env, inboxId, {}),
    subjectContains
      ? listMessages(env, inboxId, { subjectContains })
      : listMessages(env, inboxId, {}),
    listCallbackDeliveries(env, inboxId, 20),
    buildWaitTimeoutDebug(env, inboxId, waitOpts),
  ]);

  const messages = allMessages.map((m) => {
    const links = parseLinks(m.links_json);
    return {
      id: m.id,
      from: m.from_addr,
      subject: m.subject,
      otp: m.otp,
      primaryLink: primaryLink(links),
      receivedAt: m.received_at,
      hasRaw: Boolean(m.raw_r2_key),
      ...(m.raw_r2_key
        ? { rawUrl: `/v1/inboxes/${inboxId}/messages/${m.id}/raw` }
        : {}),
    };
  });

  const troubleshooting = buildTroubleshooting({
    subjectContains,
    messageIndex,
    messageCount: allMessages.length,
    matchingCount: subjectContains ? filteredMessages.length : allMessages.length,
    callbacks,
    waitHint: waitDebug.hint,
  });

  const base = options.apiBaseUrl.replace(/\/$/, "");
  const debugUrl = debugUiUrl(base, inboxId);
  const recovery = buildRecovery({
    inboxId,
    subjectContains,
    messageIndex,
    messageCount: allMessages.length,
    matchingCount: subjectContains ? filteredMessages.length : allMessages.length,
    callbacks,
    messages,
    debugUiUrl: debugUrl,
  });

  const quota = waitDebug.monthlyQuota;
  if (quota) {
    troubleshooting.unshift(quota.message);
    recovery.failureSummary = { code: "monthly_quota_exceeded", message: quota.message, confidence: "high" };
    recovery.recommendedAction = {
      type: "open_debug_ui",
      confidence: "high",
      reason: quota.message,
      label: quota.plan === "free" ? "Upgrade to Pro" : "Wait for the monthly reset",
      href: quota.plan === "free" ? "https://webmailagent.com/upgrade.html" : debugUrl,
    };
  }

  return {
    inboxId: inbox.id,
    address: inbox.address,
    label: inbox.label,
    expiresAt: inbox.expires_at,
    callbackUrl: inbox.callback_url,
    messageCount: allMessages.length,
    messages,
    callbacks: callbacks.map((row) => ({
      id: row.id,
      callbackUrl: row.callback_url,
      messageId: row.message_id,
      statusCode: row.status_code,
      ok: row.ok,
      error: row.error_text,
      durationMs: row.duration_ms,
      createdAt: row.created_at,
    })),
    waitDebug,
    troubleshooting,
    failureSummary: recovery.failureSummary,
    recommendedAction: recovery.recommendedAction,
    retry: recovery.retry,
    nextActions: recovery.nextActions,
    debugUiUrl: debugUrl,
    apiMessagesUrl: `${base}/v1/inboxes/${inboxId}/messages`,
  };
}

function buildTroubleshooting(input: {
  subjectContains?: string;
  messageIndex: number;
  messageCount: number;
  matchingCount: number;
  callbacks: Awaited<ReturnType<typeof listCallbackDeliveries>>;
  waitHint: string;
}): string[] {
  const steps: string[] = [input.waitHint];

  if (!input.messageCount) {
    steps.push(
      "0 messages: check Resend webhook POST /webhooks/resend and that staging sends mail."
    );
    steps.push("Check service / expectFrom allowlist (GET /v1 for presets).");
  } else if (input.subjectContains) {
    steps.push(
      `${input.messageCount} message(s), subjectContains="${input.subjectContains}", messageIndex=${input.messageIndex}.`
    );
    if (input.messageIndex > 0) {
      steps.push("Welcome + verify: use messageIndex=1 for the second email.");
    }
  } else if (input.messageIndex > 0 && input.messageCount <= input.messageIndex) {
    steps.push(
      `Need messageIndex=${input.messageIndex}, but only ${input.messageCount} message(s).`
    );
  }

  const failedCb = input.callbacks.filter((d) => !d.ok);
  if (failedCb.length) {
    steps.push(
      `Callback failed (${failedCb.length}): status ${failedCb.map((d) => d.status_code).join(", ")} — see GET …/callbacks.`
    );
  } else if (input.callbacks.length) {
    steps.push(`Callbacks OK (${input.callbacks.length} delivery log entries).`);
  }

  steps.push("Open debugUiUrl or GET /v1/inboxes?label=… for related inboxes.");
  return steps;
}

function buildRecovery(input: {
  inboxId: string;
  subjectContains?: string;
  messageIndex: number;
  messageCount: number;
  matchingCount: number;
  callbacks: Awaited<ReturnType<typeof listCallbackDeliveries>>;
  messages: InboxDiagnoseResult["messages"];
  debugUiUrl: string;
}): Pick<
  InboxDiagnoseResult,
  "failureSummary" | "recommendedAction" | "retry" | "nextActions"
> {
  const waitPath = `/v1/inboxes/${input.inboxId}/wait`;
  const simulatePath = `/v1/inboxes/${input.inboxId}/simulate`;
  const retry = {
    keepInbox: true,
    wait: {
      method: "GET" as const,
      path: waitPath,
      query: {
        timeoutSeconds: 120,
        ...(input.subjectContains ? { subjectContains: input.subjectContains } : {}),
        messageIndex: input.messageIndex,
      },
    },
    simulate: {
      method: "POST" as const,
      path: simulatePath,
      body: {
        subject: input.subjectContains
          ? `MailAgent retry: ${input.subjectContains}`
          : "MailAgent retry verification",
        otp: "482910",
      },
    },
  };

  const hasFailedCallback = input.callbacks.some((d) => !d.ok);
  const hasVerification = input.messages.some((m) => Boolean(m.otp || m.primaryLink));

  const actions: DiagnoseAction[] = [];
  let failureSummary: InboxDiagnoseResult["failureSummary"];
  let recommendedAction: DiagnoseAction;

  const waitAction: DiagnoseAction = {
    type: "wait",
    confidence: "medium",
    label: "Retry wait on this inbox",
    reason: "Keep the same inbox and wait again before creating a new address.",
    payload: retry.wait,
  };
  const simulateAction: DiagnoseAction = {
    type: "simulate_message",
    confidence: "medium",
    label: "Simulate a verification message",
    reason: "Use simulate to validate extraction and app-side test wiring without SMTP.",
    payload: retry.simulate,
  };
  const debugAction: DiagnoseAction = {
    type: "open_debug_ui",
    confidence: "medium",
    label: "Open debug UI",
    reason: "Inspect messages, callbacks, raw MIME, and troubleshooting in the console.",
    href: input.debugUiUrl,
  };

  if (!input.messageCount) {
    failureSummary = {
      code: "no_messages",
      message: "No messages have reached this inbox yet.",
      confidence: "high",
    };
    recommendedAction = {
      ...waitAction,
      confidence: "high",
      reason:
        "No message is stored yet; keep the inbox and retry wait while checking sender allowlist/webhook setup.",
    };
    actions.push(recommendedAction, simulateAction, debugAction);
  } else if (input.subjectContains && !input.matchingCount) {
    failureSummary = {
      code: "subject_filter_no_match",
      message: `Messages exist, but none match subjectContains="${input.subjectContains}".`,
      confidence: "high",
    };
    recommendedAction = {
      type: "adjust_subject_filter",
      confidence: "high",
      label: "Relax subject filter",
      reason: "Messages arrived with different subjects; retry without or with a broader subjectContains.",
      payload: {
        method: "GET",
        path: waitPath,
        query: { timeoutSeconds: 60, messageIndex: 0 },
      },
    };
    actions.push(recommendedAction, waitAction, debugAction);
  } else if (input.matchingCount <= input.messageIndex) {
    failureSummary = {
      code: "message_index_too_high",
      message: `Need messageIndex=${input.messageIndex}, but only ${input.matchingCount} matching message(s) exist.`,
      confidence: "high",
    };
    recommendedAction = {
      type: "adjust_message_index",
      confidence: "high",
      label: "Lower messageIndex",
      reason: "The requested message index is not available yet; use messageIndex=0 or wait for another email.",
      payload: {
        method: "GET",
        path: waitPath,
        query: {
          timeoutSeconds: 60,
          ...(input.subjectContains ? { subjectContains: input.subjectContains } : {}),
          messageIndex: 0,
        },
      },
    };
    actions.push(recommendedAction, waitAction, debugAction);
  } else if (hasFailedCallback) {
    failureSummary = {
      code: "callback_failed",
      message: "Message processing succeeded, but one or more callbacks failed.",
      confidence: "high",
    };
    recommendedAction = {
      type: "fix_callback",
      confidence: "high",
      label: "Inspect callback endpoint",
      reason: "At least one callback delivery is not ok; fix the endpoint or inspect callback logs.",
      payload: { method: "GET", path: `/v1/inboxes/${input.inboxId}/callbacks` },
    };
    actions.push(recommendedAction, debugAction);
  } else if (hasVerification) {
    failureSummary = {
      code: "message_received",
      message: "A message with verification data is available.",
      confidence: "high",
    };
    recommendedAction = {
      type: "extract_verification",
      confidence: "high",
      label: "Use extracted verification",
      reason: "The inbox already has an OTP or primary link; use GET /extract or the message summary.",
      payload: { method: "GET", path: `/v1/inboxes/${input.inboxId}/extract` },
    };
    actions.push(recommendedAction, debugAction);
  } else {
    failureSummary = {
      code: "unknown",
      message: "Messages exist, but no clear verification or callback failure was found.",
      confidence: "low",
    };
    recommendedAction = debugAction;
    actions.push(recommendedAction, waitAction, simulateAction);
  }

  return {
    failureSummary,
    recommendedAction,
    retry,
    nextActions: dedupeActions(actions),
  };
}

function dedupeActions(actions: DiagnoseAction[]): DiagnoseAction[] {
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = `${action.type}:${action.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function debugUiUrl(apiBase: string, inboxId: string): string {
  const base = apiBase.replace(/\/$/, "");
  if (base === LEGACY_API_ORIGIN) return `${LEGACY_WORKSPACE_ORIGIN}/debug.html?inbox=${encodeURIComponent(inboxId)}`;
  if (base === NAVORINA_API_ORIGIN) return `${NAVORINA_WORKSPACE_ORIGIN}/debug.html?inbox=${encodeURIComponent(inboxId)}`;
  if (base.includes("workers.dev") || base.includes("localhost") || base.includes("127.0.0.1")) {
    return `${base}/debug.html?inbox=${encodeURIComponent(inboxId)}`;
  }
  return `${base}/debug.html?inbox=${encodeURIComponent(inboxId)}`;
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

/** Wait for message (poll) — for /wait, /open, MCP progress */
import type { Env } from "../env";
import { listMessages, type MessageRow } from "./inbox";
import { monthlyQuotaForInbox, type MonthlyQuotaStatus } from "./email-usage";

export type WaitProgressEvent = {
  inboxId: string;
  elapsedSec: number;
  timeoutSec: number;
  progress: number;
  status: "waiting" | "received";
  message: string;
  messageCount?: number;
};

export type WaitOptions = {
  subjectContains?: string;
  /** 0 = newest matching message (default), 1 = second, … */
  messageIndex?: number;
  onProgress?: (event: WaitProgressEvent) => void;
};

export type WaitTimeoutDebug = {
  messageCount: number;
  matchingCount: number;
  messageIndex: number;
  subjectContains?: string;
  subjects: Array<{
    id: string;
    subject: string;
    from: string;
    receivedAt: string;
    otp: string | null;
  }>;
  hint: string;
  /** Set when the inbox owner is over the monthly email cap: inbound mail is dropped. */
  reason?: "monthly_quota_exceeded";
  monthlyQuota?: MonthlyQuotaStatus;
};

/** Wait for Nth message (0 = newest among matches) */
export async function waitForMessage(
  env: Env,
  inboxId: string,
  timeoutSec: number,
  options?: WaitOptions
): Promise<MessageRow | null> {
  const cap = Math.min(Math.max(timeoutSec, 5), 120);
  const needle = options?.subjectContains?.trim().toLowerCase();
  const index = Math.max(0, Math.floor(options?.messageIndex ?? 0));
  const deadline = Date.now() + cap * 1000;
  const started = Date.now();
  let lastEmitSec = -1;

  const emit = (status: WaitProgressEvent["status"], messageCount?: number) => {
    if (!options?.onProgress) return;
    const elapsedSec = Math.floor((Date.now() - started) / 1000);
    if (status === "waiting" && elapsedSec === lastEmitSec) return;
    lastEmitSec = elapsedSec;
    options.onProgress({
      inboxId,
      elapsedSec,
      timeoutSec: cap,
      progress: Math.min(100, Math.round((elapsedSec / cap) * 100)),
      status,
      message:
        status === "received"
          ? "Verification email received"
          : `Waiting for email (${elapsedSec}/${cap}s)…`,
      messageCount,
    });
  };

  emit("waiting", 0);

  while (Date.now() < deadline) {
    const messages = await listMessages(env, inboxId, {
      subjectContains: needle,
    });
    const match = messages[index];
    if (match) {
      emit("received", messages.length);
      return match;
    }
    emit("waiting", messages.length);
    await sleep(500);
  }
  return null;
}

/** @deprecated alias — messageIndex 0 */
export async function waitForFirstMessage(
  env: Env,
  inboxId: string,
  timeoutSec: number,
  options?: Omit<WaitOptions, "messageIndex">
): Promise<MessageRow | null> {
  return waitForMessage(env, inboxId, timeoutSec, options);
}

/** Context for 408 timeout — QA debug */
export async function buildWaitTimeoutDebug(
  env: Env,
  inboxId: string,
  options?: Pick<WaitOptions, "subjectContains" | "messageIndex">
): Promise<WaitTimeoutDebug> {
  const index = Math.max(0, Math.floor(options?.messageIndex ?? 0));
  const needle = options?.subjectContains?.trim();
  const [all, quota] = await Promise.all([
    listMessages(env, inboxId, {}),
    monthlyQuotaForInbox(env, inboxId),
  ]);
  const matching = needle
    ? await listMessages(env, inboxId, { subjectContains: needle })
    : all;

  let hint = "No matching email. Check webhook, expectFrom, subjectContains.";
  if (all.length && !matching.length && needle) {
    hint = `Found ${all.length} message(s) but none match subjectContains="${needle}".`;
  } else if (matching.length > 0 && matching.length <= index) {
    hint = `Need messageIndex=${index} but only ${matching.length} matching message(s). Wait for the next email or lower messageIndex.`;
  } else if (all.length && !needle) {
    hint = `Found ${all.length} message(s) but wait timed out before index ${index}.`;
  }
  if (quota) hint = quota.message;

  return {
    messageCount: all.length,
    matchingCount: matching.length,
    messageIndex: index,
    ...(needle ? { subjectContains: needle } : {}),
    subjects: all.slice(0, 15).map((m) => ({
      id: m.id,
      subject: m.subject,
      from: m.from_addr,
      receivedAt: m.received_at,
      otp: m.otp,
    })),
    hint,
    ...(quota ? { reason: quota.error, monthlyQuota: quota } : {}),
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

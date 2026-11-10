/** Team-wide HTTPS webhook on every inbound message (all team inboxes). */
import type { Env, MessageNotifyPayload } from "../env";
import { parseCallbackUrl } from "../lib/callback-url";
import { getDb } from "../db/client";
import { fireInboxCallback } from "./callback";
import { recordCallbackRunSession } from "./agent-run-session";
import type { InboxRow } from "./inbox";

export type TeamWebhookConfig = {
  configured: boolean;
  url: string | null;
  urlMasked: string | null;
  events: ["message.received"];
};

export function maskWebhookUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname;
    const maskedHost =
      host.length <= 6 ? `${host.slice(0, 2)}…` : `${host.slice(0, 3)}…${host.slice(-3)}`;
    return `${u.protocol}//${maskedHost}${u.pathname.length > 1 ? u.pathname : ""}`;
  } catch {
    return "https://…";
  }
}

export async function getTeamIdByApiKeyHint(
  env: Env,
  hint: string | null | undefined
): Promise<string | null> {
  if (!hint?.trim()) return null;
  const sql = getDb(env);
  const rows = (await sql`
    SELECT team_id FROM api_keys WHERE key_hint = ${hint.trim()} LIMIT 1
  `) as { team_id: string }[];
  return rows[0]?.team_id ?? null;
}

export async function getTeamEventWebhook(
  env: Env,
  teamId: string
): Promise<TeamWebhookConfig> {
  const sql = getDb(env);
  const rows = (await sql`
    SELECT event_webhook_url FROM teams WHERE id = ${teamId} LIMIT 1
  `) as { event_webhook_url: string | null }[];
  const url = rows[0]?.event_webhook_url?.trim() || null;
  return {
    configured: Boolean(url),
    url,
    urlMasked: url ? maskWebhookUrl(url) : null,
    events: ["message.received"],
  };
}

export async function setTeamEventWebhook(
  env: Env,
  teamId: string,
  rawUrl: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = parseCallbackUrl(rawUrl);
  if (!url) return { ok: false, error: "invalid_webhook_url" };

  const sql = getDb(env);
  await sql`
    UPDATE teams SET event_webhook_url = ${url} WHERE id = ${teamId}
  `;
  return { ok: true };
}

export async function clearTeamEventWebhook(
  env: Env,
  teamId: string
): Promise<void> {
  const sql = getDb(env);
  await sql`
    UPDATE teams SET event_webhook_url = NULL WHERE id = ${teamId}
  `;
}

/** POST team event webhook when inbox belongs to a registered team key. */
export async function fireTeamEventForMessage(
  env: Env,
  input: {
    inbox: Pick<InboxRow, "id" | "address" | "label" | "api_key_hint">;
    messageId: string;
    payload: MessageNotifyPayload;
  }
): Promise<{ ok: boolean; statusCode: number | null } | null> {
  const teamId = await getTeamIdByApiKeyHint(env, input.inbox.api_key_hint);
  if (!teamId) return null;

  const config = await getTeamEventWebhook(env, teamId);
  if (!config.url) return null;

  const result = await fireInboxCallback(env, {
    inboxId: input.inbox.id,
    messageId: input.messageId,
    callbackUrl: config.url,
    apiKeyHint: input.inbox.api_key_hint,
    payload: {
      ...input.payload,
      address: input.inbox.address,
      label: input.inbox.label,
      teamId,
      source: "team_webhook",
    },
  });
  await recordCallbackRunSession(env, input.inbox, {
    messageId: input.messageId,
    ok: result.ok,
    statusCode: result.statusCode,
    source: "team_webhook",
  });
  return result;
}

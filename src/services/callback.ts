/** POST to callback URL + record in callback_deliveries */
import type { Env, MessageNotifyPayload } from "../env";
import { recordCallbackDelivery } from "./callback-log";
import { getDb } from "../db/client";
import { SIGNATURE_HEADER, signatureHeader, signingMaster, webhookOwner, webhookSecret } from "../lib/webhook-signature";

/** Secret for the inbox owner, or null when signing is not possible. */
async function secretForInbox(env: Env, teamId: string | null | undefined, hint: string | null | undefined): Promise<string | null> {
  const master = signingMaster(env);
  if (!master) return null;
  let team = teamId ?? null;
  if (!team && hint) {
    try {
      const rows = (await getDb(env)`SELECT team_id FROM api_keys WHERE key_hint = ${hint} LIMIT 1`) as { team_id: string }[];
      team = rows[0]?.team_id ?? null;
    } catch {
      team = null;
    }
  }
  const owner = webhookOwner(team, hint);
  return owner ? webhookSecret(master, owner) : null;
}

export async function fireInboxCallback(
  env: Env,
  input: {
    inboxId: string;
    messageId: string;
    callbackUrl: string;
    /** Inbox key hint, used to find the owner and sign the request. */
    apiKeyHint?: string | null;
    payload: MessageNotifyPayload & {
      address?: string;
      label?: string | null;
      teamId?: string;
      source?: string;
    };
  }
): Promise<{ ok: boolean; statusCode: number | null }> {
  const started = Date.now();
  let statusCode: number | null = null;
  let ok = false;
  let errorText: string | null = null;

  try {
    const body = JSON.stringify({
      event: "message.received",
      ...input.payload,
    });
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const secret = await secretForInbox(env, input.payload.teamId, input.apiKeyHint);
    if (secret) headers[SIGNATURE_HEADER] = await signatureHeader(secret, body);
    const res = await fetch(input.callbackUrl, { method: "POST", headers, body });
    statusCode = res.status;
    ok = res.ok;
    if (!ok) {
      errorText = `HTTP ${res.status}`;
      console.warn("callback failed", input.callbackUrl, res.status);
    }
  } catch (e) {
    errorText = e instanceof Error ? e.message : String(e);
    console.warn("callback error", input.callbackUrl, e);
  }

  const durationMs = Date.now() - started;
  await recordCallbackDelivery(env, {
    inboxId: input.inboxId,
    messageId: input.messageId,
    callbackUrl: input.callbackUrl,
    statusCode,
    ok,
    errorText,
    durationMs,
  });

  return { ok, statusCode };
}

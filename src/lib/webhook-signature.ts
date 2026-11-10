/**
 * Signed webhooks, Stripe style.
 * Header: MailAgent-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
 * The secret is per team (or per legacy key) and derived from a server master secret,
 * so nothing new is stored. Receivers get it from GET /v1/webhook-secret.
 */

export const SIGNATURE_HEADER = "MailAgent-Signature";
export const SIGNATURE_TOLERANCE_SECONDS = 300;

const enc = new TextEncoder();

async function hmacHex(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", k, enc.encode(message));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Owner of the webhook: the team, or the legacy key hint when there is no team. */
export function webhookOwner(teamId: string | null | undefined, hint: string | null | undefined): string | null {
  if (teamId) return `team:${teamId}`;
  if (hint) return `key:${hint}`;
  return null;
}

/** Stable per-owner secret: whsec_ + 64 hex. Same master and owner give the same secret. */
export async function webhookSecret(master: string, owner: string): Promise<string> {
  return `whsec_${await hmacHex(master, `mailagent-webhook:${owner}`)}`;
}

export async function signatureHeader(secret: string, body: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  return `t=${nowSeconds},v1=${await hmacHex(secret, `${nowSeconds}.${body}`)}`;
}

/** Receiver side, also used in docs and tests. */
export async function verifySignature(
  secret: string,
  body: string,
  header: string | null | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS
): Promise<boolean> {
  if (!header) return false;
  let t: number | null = null;
  const sigs: string[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") t = Number(v);
    if (k === "v1" && v) sigs.push(v);
  }
  if (t === null || !Number.isFinite(t) || !sigs.length) return false;
  if (Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const expected = await hmacHex(secret, `${t}.${body}`);
  return sigs.some((s) => s.length === expected.length && [...s].reduce((d, c, i) => d | (c.charCodeAt(0) ^ expected.charCodeAt(i)), 0) === 0);
}

export function signingMaster(env: { WEBHOOK_SIGNING_SECRET?: string; API_KEY?: string }): string | null {
  return env.WEBHOOK_SIGNING_SECRET?.trim() || env.API_KEY?.trim() || null;
}

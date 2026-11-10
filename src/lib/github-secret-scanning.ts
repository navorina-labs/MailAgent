/**
 * GitHub Secret Scanning partner alerts.
 * GitHub finds strings matching our key pattern in public code and POSTs them to us.
 * The body is signed with ECDSA P-256 / SHA-256; the signature is ASN.1 DER, base64.
 * Public keys: https://api.github.com/meta/public_keys/secret_scanning
 */

export const KEY_PATTERN = /^ma_[A-Za-z0-9_-]{32}$/;
export const GITHUB_KEYS_URL = "https://api.github.com/meta/public_keys/secret_scanning";

export type GithubAlert = { token: string; type: string; url?: string; source?: string };
export type GithubPublicKey = { key_identifier: string; key: string; is_current?: boolean };

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** DER ECDSA signature (SEQUENCE { INTEGER r, INTEGER s }) to raw r||s, 32 bytes each. */
export function derToRawP256(der: Uint8Array): Uint8Array | null {
  let i = 0;
  if (der[i++] !== 0x30) return null;
  let len = der[i++];
  if (len & 0x80) i += len & 0x7f; // long form length, skip
  const readInt = (): Uint8Array | null => {
    if (der[i++] !== 0x02) return null;
    const n = der[i++];
    let v = der.slice(i, i + n);
    i += n;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    if (v.length > 32) return null;
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return out;
  };
  const r = readInt();
  const s = readInt();
  if (!r || !s) return null;
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

export async function importPemP256(pem: string): Promise<CryptoKey> {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return crypto.subtle.importKey("spki", b64ToBytes(b64), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
}

export async function verifyGithubSignature(
  body: string,
  signatureB64: string | undefined,
  keyId: string | undefined,
  keys: GithubPublicKey[]
): Promise<boolean> {
  if (!signatureB64 || !keyId) return false;
  const entry = keys.find((k) => k.key_identifier === keyId);
  if (!entry) return false;
  const raw = derToRawP256(b64ToBytes(signatureB64));
  if (!raw) return false;
  const key = await importPemP256(entry.key);
  return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, raw, new TextEncoder().encode(body));
}

export function parseAlerts(body: unknown): GithubAlert[] | null {
  if (!Array.isArray(body)) return null;
  const out: GithubAlert[] = [];
  for (const a of body) {
    if (!a || typeof a !== "object" || typeof (a as GithubAlert).token !== "string") return null;
    out.push(a as GithubAlert);
  }
  return out;
}

export function maskKey(token: string): string {
  return token.length > 10 ? token.slice(0, 6) + "..." + token.slice(-4) : "ma_...";
}

export function leakNoticeEmail(masked: string, url: string | undefined, replaceUrl: string): { subject: string; text: string } {
  return {
    subject: "Your Mail Agent API key was found in public code and revoked",
    text: [
      `GitHub found your Mail Agent API key ${masked} in public code${url ? `: ${url}` : "."}`,
      "",
      "We revoked it right away, so it no longer works. Remove it from the code and its history.",
      "",
      `Get a new key: ${replaceUrl}`,
      "",
      "Keep keys in CI secrets or environment variables, never in the repository.",
    ].join("\n"),
  };
}

/** Shared fetch helpers for contract QA scripts (API-only simulate, no DATABASE_URL). */
import { apiOrigin } from "./public-origins.mjs";

export function contractBase() {
  return apiOrigin();
}

export function contractHeaders() {
  const apiKey = process.env.MAILAGENT_API_KEY ?? process.env.API_KEY;
  if (!apiKey) return null;
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export async function contractApi(base, headers, path, init = {}) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...headers, ...init.headers },
  });
  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
  }
  return { ok: res.ok, status: res.status, json };
}

/** POST /v1/inboxes/:id/simulate — replaces DB simulate-inbound.mjs in CI */
export async function contractSimulate(base, headers, inboxId, body) {
  return contractApi(base, headers, `/v1/inboxes/${inboxId}/simulate`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

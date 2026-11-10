/** POST /webhooks/github/secret-scanning: GitHub reports leaked ma_ keys; we revoke them and tell the owner. */
import { Hono } from "hono";
import type { Env } from "../env";
import { getDb } from "../db/client";
import { apiKeyHashFromToken } from "../lib/api-key-hint";
import { createResendClient } from "../services/resend-mail";
import { workspaceUrl } from "../lib/public-origin";
import {
  GITHUB_KEYS_URL,
  KEY_PATTERN,
  leakNoticeEmail,
  maskKey,
  parseAlerts,
  verifyGithubSignature,
  type GithubPublicKey,
} from "../lib/github-secret-scanning";

export const githubSecretScanningRoutes = new Hono<{ Bindings: Env }>();

const KEYS_CACHE = "github:secret-scanning:keys";

async function githubKeys(env: Env, refresh = false): Promise<GithubPublicKey[]> {
  const kv = env.RATE_LIMIT;
  if (!refresh && kv) {
    const cached = await kv.get(KEYS_CACHE);
    if (cached) return JSON.parse(cached) as GithubPublicKey[];
  }
  const res = await fetch(GITHUB_KEYS_URL, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "mailagent-secret-scanning" },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { public_keys?: GithubPublicKey[] };
  const keys = data.public_keys ?? [];
  if (kv && keys.length) await kv.put(KEYS_CACHE, JSON.stringify(keys), { expirationTtl: 3600 });
  return keys;
}

githubSecretScanningRoutes.post("/secret-scanning", async (c) => {
  const body = await c.req.text();
  const sig = c.req.header("Github-Public-Key-Signature");
  const keyId = c.req.header("Github-Public-Key-Identifier");

  let ok = await verifyGithubSignature(body, sig, keyId, await githubKeys(c.env));
  if (!ok) ok = await verifyGithubSignature(body, sig, keyId, await githubKeys(c.env, true)); // key rotated at GitHub
  if (!ok) return c.json({ error: "invalid_signature" }, 401);

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const alerts = parseAlerts(parsed);
  if (!alerts) return c.json({ error: "invalid_body" }, 400);

  const sql = getDb(c.env);
  const from = c.env.OUTBOUND_FROM?.trim();
  const labels: { token_raw: string; token_type: string; label: "true_positive" | "false_positive" }[] = [];

  for (const alert of alerts.slice(0, 100)) {
    if (!KEY_PATTERN.test(alert.token)) {
      labels.push({ token_raw: alert.token, token_type: alert.type, label: "false_positive" });
      continue;
    }
    const hash = await apiKeyHashFromToken(alert.token);
    const rows = (await sql`
      UPDATE api_keys k SET revoked_at = NOW()
      FROM teams t
      WHERE k.key_hash = ${hash} AND t.id = k.team_id AND k.revoked_at IS NULL
      RETURNING k.id, t.name AS team_name
    `) as { id: string; team_name: string }[];
    const hit = rows[0];
    labels.push({ token_raw: alert.token, token_type: alert.type, label: hit ? "true_positive" : "false_positive" });
    if (!hit) continue;
    console.warn("github_secret_scanning_revoked", hit.id, alert.url ?? "");

    // Self-serve teams are named by the signup email.
    const owner = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(hit.team_name) ? hit.team_name : null;
    if (owner && from && c.env.RESEND_API_KEY) {
      const mail = leakNoticeEmail(
        maskKey(alert.token),
        alert.url,
        workspaceUrl("/get-key.html?replace", c.env.MAILAGENT_WORKSPACE_ORIGIN)
      );
      const { error } = await createResendClient(c.env).emails.send({ from, to: [owner], ...mail });
      if (error) console.error("leak_notice_send_failed", error.message);
    }
  }

  return c.json(labels);
});

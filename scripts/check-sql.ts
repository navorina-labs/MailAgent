/**
 * SQL contract against the real database, run in the deploy job after migrations and before the Worker ships.
 * Uses the production functions on a throwaway team, then deletes it (keys and usage cascade).
 * Covers: key replacement, leaked-key revoke, MCP token state, suspension, monthly cap, abuse aggregate.
 *   DATABASE_URL=... npx tsx scripts/check-sql.ts
 */
import assert from "node:assert/strict";
import type { Env } from "../src/env";
import { getDb } from "../src/db/client";
import { newApiKey } from "../src/lib/key-signup";
import { apiKeyHintFromToken } from "../src/lib/api-key-hint";
import {
  addTeamKey,
  applyMcpTokenState,
  registerApiKey,
  resolveAuth,
  revokeKeyByToken,
  rotateTeamKeys,
  type ResolvedAuth,
} from "../src/services/api-key-store";
import { suspendTeam, teamActivity24h } from "../src/services/abuse-guard";
import { consumeMonthlyEmail } from "../src/services/email-usage";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("check-sql: skipped (no DATABASE_URL)");
  process.exit(0);
}
const env = { DATABASE_URL: url } as Env;
const sql = getDb(env);

const mcp = async (teamId: string, apiKeyId: string, token: string): Promise<ResolvedAuth> => ({
  hint: await apiKeyHintFromToken(token),
  plan: "free",
  teamId,
  apiKeyId,
  label: "sql-check",
  scope: { labelPrefix: null, readOnly: false },
});

const k1 = newApiKey();
const { teamId, apiKeyId: id1 } = await registerApiKey(env, {
  token: k1,
  teamName: `sql-check-${Date.now()}`,
  label: "sql-check",
  plan: "free",
});
const step = (name: string) => console.log("ok  " + name);

try {
  const a1 = await resolveAuth(env, k1);
  assert.ok(a1 && a1.teamId === teamId && !a1.suspended);
  step("resolveAuth reads suspended_at");

  const k2 = newApiKey();
  await addTeamKey(env, teamId, { token: k2, label: "sql-check" });
  assert.ok(await applyMcpTokenState(env, await mcp(teamId, id1, k1)));
  step("MCP token state: live key");

  assert.equal((await consumeMonthlyEmail(env, teamId, "free")).ok, true);
  step("monthly email cap counter");

  const k3 = newApiKey();
  const rot = await rotateTeamKeys(env, teamId, { token: k3, label: "sql-check" });
  assert.equal(rot.revoked, 2);
  assert.equal(await resolveAuth(env, k1), null);
  assert.equal(await resolveAuth(env, k2), null);
  assert.ok(await resolveAuth(env, k3));
  step("rotateTeamKeys: old keys revoked, new key works");

  assert.equal(await applyMcpTokenState(env, await mcp(teamId, id1, k1)), null);
  step("MCP token state: revoked key kills its token");

  const leak = await revokeKeyByToken(env, k3);
  assert.ok(leak && leak.teamName.startsWith("sql-check-"));
  assert.equal(await resolveAuth(env, k3), null);
  assert.equal(await revokeKeyByToken(env, k3), null);
  step("revokeKeyByToken: leaked key revoked once");

  const k4 = newApiKey();
  const { apiKeyId: id4 } = await addTeamKey(env, teamId, { token: k4, label: "sql-check" });
  await suspendTeam(env, teamId, "sql-check");
  assert.equal((await resolveAuth(env, k4))?.suspended, true);
  assert.equal((await applyMcpTokenState(env, await mcp(teamId, id4, k4)))?.suspended, true);
  step("suspension: API key and MCP token blocked");

  const activity = await teamActivity24h(env);
  assert.ok(Array.isArray(activity));
  step(`abuse aggregate runs (${activity.length} active teams)`);
} finally {
  await sql`DELETE FROM teams WHERE id = ${teamId}`;
  const left = (await sql`SELECT COUNT(*)::int AS n FROM api_keys WHERE team_id = ${teamId}`) as { n: number }[];
  assert.equal(left[0].n, 0);
  console.log("ok  cleanup: throwaway team removed");
}
console.log("check-sql: ok");

#!/usr/bin/env node
/**
 * Operator tools for the abuse guard. Accepts a team id or the signup email.
 *   npm run team:abuse -- <team|email>              last 24h: senders, inboxes, status
 *   npm run team:suspend -- <team|email> "reason"   keys stop working (403 account_suspended)
 *   npm run team:unsuspend -- <team|email>
 */
import "./load-env.mjs";
import { neon } from "@neondatabase/serverless";

const [action, who, ...rest] = process.argv.slice(2);
if (!["show", "suspend", "unsuspend"].includes(action) || !who) {
  console.error('Usage: team-abuse.mjs show|suspend|unsuspend <team_id|email> ["reason"]');
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL required");
  process.exit(1);
}
const sql = neon(url);

const teams = await sql`
  SELECT id, name, plan, suspended_at, suspended_reason FROM teams
  WHERE id = ${who} OR lower(name) = ${who.toLowerCase()}
  ORDER BY created_at ASC LIMIT 1
`;
const team = teams[0];
if (!team) {
  console.error(`No team for ${who}`);
  process.exit(1);
}

if (action === "suspend") {
  const reason = rest.join(" ").trim() || "operator";
  await sql`UPDATE teams SET suspended_at = NOW(), suspended_reason = ${reason} WHERE id = ${team.id}`;
  console.log(`team ${team.id} suspended: ${reason}`);
} else if (action === "unsuspend") {
  await sql`UPDATE teams SET suspended_at = NULL, suspended_reason = NULL WHERE id = ${team.id}`;
  console.log(`team ${team.id} active again`);
} else {
  console.log(`team ${team.id}  ${team.name}  plan=${team.plan}`);
  console.log(team.suspended_at ? `SUSPENDED ${team.suspended_at}: ${team.suspended_reason}` : "status: active");
  const senders = await sql`
    SELECT lower(m.from_addr) AS sender, COUNT(*)::int AS n, MAX(m.received_at) AS last
    FROM messages m
    JOIN inboxes i ON i.id = m.inbox_id
    JOIN api_keys k ON k.key_hint = i.api_key_hint
    WHERE k.team_id = ${team.id} AND m.received_at > NOW() - INTERVAL '24 hours'
    GROUP BY 1 ORDER BY n DESC LIMIT 30
  `;
  console.log(`\nsenders in 24h (${senders.length} shown):`);
  for (const s of senders) console.log(`  ${String(s.n).padStart(4)}  ${s.sender}`);
}

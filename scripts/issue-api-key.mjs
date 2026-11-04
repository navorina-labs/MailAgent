#!/usr/bin/env node
/** Generate key; --register saves to Neon (teams + api_keys) */
import "./load-env.mjs";
import { randomBytes, createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { apiOrigin } from "./lib/public-origins.mjs";
import { nanoid } from "nanoid";

const args = process.argv.slice(2);
const register = args.includes("--register");
const readOnly = args.includes("--read-only");
const labelPrefixFlag = args.find((a) => a.startsWith("--label-prefix="));
const labelPrefix = labelPrefixFlag?.slice("--label-prefix=".length);
const label =
  args.find(
    (a) =>
      a !== "--register" &&
      a !== "--read-only" &&
      !a.startsWith("--")
  ) ?? "pilot";
const key = `ma_${randomBytes(24).toString("base64url")}`;

function hint(token) {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

function hash(token) {
  return createHash("sha256").update(token).digest("hex");
}

console.log(`New API key (${label}):\n`);
console.log(key);

if (register) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("\nDATABASE_URL required for --register");
    process.exit(1);
  }
  const sql = neon(url);
  const teamId = nanoid(10);
  const apiKeyId = nanoid(10);
  const teamName = `team-${label}`;

  await sql`
    INSERT INTO teams (id, name, plan)
    VALUES (${teamId}, ${teamName}, 'free')
  `;
  await sql`
    INSERT INTO api_keys (id, team_id, key_hash, key_hint, label, scope_label_prefix, scope_read_only)
    VALUES (${apiKeyId}, ${teamId}, ${hash(key)}, ${hint(key)}, ${label}, ${labelPrefix?.slice(0, 64) ?? null}, ${readOnly})
  `;

  console.log(`\nRegistered in DB: team=${teamId} plan=free`);
  if (labelPrefix || readOnly) {
    console.log(`Scope: labelPrefix=${labelPrefix ?? "(none)"} readOnly=${readOnly}`);
  }
  console.log("Use this key only (remove from API_KEYS if duplicated).\n");
} else {
  console.log(`
Add to Worker (append to existing API_KEYS, comma-separated):

  npx wrangler secret put API_KEYS

Or register in Neon (recommended for billing):

  npm run issue:key -- --register ${label}
`);
}

console.log(`Pilot .env:
  MAILAGENT_API_URL=${apiOrigin()}
  MAILAGENT_API_KEY=${key}
`);

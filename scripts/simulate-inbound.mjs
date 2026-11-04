#!/usr/bin/env node
/**
 * Local test without Gmail: inserts message into Neon (bypasses allowlist ingest).
 * Usage: node scripts/simulate-inbound.mjs <inboxId> [otp] [from] [--fire-callback] [--subject=...] [--with-attachment=filename.pdf]
 */
import "./load-env.mjs";
import { neon } from "@neondatabase/serverless";
import { nanoid } from "nanoid";
import { fireSimulatedCallback } from "./lib/fire-simulated-callback.mjs";
import { apiOrigin } from "./lib/public-origins.mjs";

const argv = process.argv.slice(2);
let fireCallback = false;
let subject = "MailAgent simulated OTP";
let attachmentFilename = null;
const positional = [];

for (const a of argv) {
  if (a === "--fire-callback") fireCallback = true;
  else if (a.startsWith("--subject=")) subject = a.slice("--subject=".length);
  else if (a.startsWith("--with-attachment="))
    attachmentFilename = a.slice("--with-attachment=".length);
  else positional.push(a);
}

const inboxId = positional[0] ?? "Js0I-1J7-JGZ";
const otp = positional[1] ?? "482910";
const fromAddr = positional[2] ?? "test@example.com";

const sql = neon(process.env.DATABASE_URL);
const rows = await sql`
  SELECT id, address FROM inboxes WHERE id = ${inboxId} AND expires_at > NOW() LIMIT 1
`;
if (!rows.length) {
  console.error("inbox not found or expired:", inboxId);
  process.exit(1);
}

const msgId = nanoid(16);
const providerId = `sim_${nanoid(12)}`;
const links = JSON.stringify(["https://example.com/verify?token=test"]);

try {
  await sql`
    INSERT INTO messages (
      id, inbox_id, provider_id, from_addr, subject,
      text_preview, html_preview, otp, links_json
    ) VALUES (
      ${msgId}, ${inboxId}, ${providerId},
      ${fromAddr}, ${subject},
      ${`Your code is ${otp}`}, NULL, ${otp}, ${links}::jsonb
    )
  `;
} catch (e) {
  console.error("insert failed", e.message);
  process.exit(1);
}

console.log("OK simulated message", { messageId: msgId, subject });

if (attachmentFilename) {
  const attId = nanoid(12);
  const attProviderId = `sim_att_${nanoid(8)}`;
  try {
    await sql`
      INSERT INTO message_attachments (
        id, message_id, provider_id, filename, content_type, size_bytes
      ) VALUES (
        ${attId}, ${msgId}, ${attProviderId}, ${attachmentFilename},
        ${"application/pdf"}, ${1024}
      )
    `;
    console.log("OK simulated attachment", { attachmentId: attId, filename: attachmentFilename });
  } catch (e) {
    console.error("attachment insert failed", e.message);
    process.exit(1);
  }
}

if (fireCallback) {
  const result = await fireSimulatedCallback(sql, inboxId, msgId);
  console.log("callback:", result.ok ? "ok" : "fail", result.statusCode, result.callbackUrl);
  if (!result.ok) process.exit(1);
}

console.log("inbox:", rows[0].address);
console.log("otp:", otp);
console.log(
  "check: curl -H \"Authorization: Bearer $API_KEY\"",
  apiOrigin(),
  "/v1/inboxes/" + inboxId + "/extract"
);

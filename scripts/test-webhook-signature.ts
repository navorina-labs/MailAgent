/** Signed webhooks: our signer, our verifier, and the Node snippet from the docs agree. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  signatureHeader,
  signingMaster,
  verifySignature,
  webhookOwner,
  webhookSecret,
} from "../src/lib/webhook-signature";

const master = "test-master";
const secretA = await webhookSecret(master, webhookOwner("team1", "hintA")!);
const secretA2 = await webhookSecret(master, webhookOwner("team1", "hintB")!);
const secretB = await webhookSecret(master, webhookOwner("team2", null)!);
assert.match(secretA, /^whsec_[0-9a-f]{64}$/);
assert.equal(secretA, secretA2, "same team, any key: same secret (survives key replacement)");
assert.notEqual(secretA, secretB);
assert.equal(webhookOwner(null, "hintX"), "key:hintX");
assert.equal(webhookOwner(null, null), null);
assert.equal(signingMaster({ WEBHOOK_SIGNING_SECRET: " s " , API_KEY: "k" }), "s");
assert.equal(signingMaster({ API_KEY: "k" }), "k");
assert.equal(signingMaster({}), null);

const body = JSON.stringify({ event: "message.received", inboxId: "inb_1", otp: "482913" });
const now = 1_794_276_000;
const header = await signatureHeader(secretA, body, now);
assert.match(header, /^t=1794276000,v1=[0-9a-f]{64}$/);

assert.equal(await verifySignature(secretA, body, header, now), true);
assert.equal(await verifySignature(secretA, body + " ", header, now), false, "tampered body");
assert.equal(await verifySignature(secretB, body, header, now), false, "wrong secret");
assert.equal(await verifySignature(secretA, body, header, now + 301), false, "replay after 5 min");
assert.equal(await verifySignature(secretA, body, null, now), false);

// The Node.js snippet from public/docs/webhooks.html.
function verifyMailAgent(rawBody: string, hdr: string, secret: string, nowSec: number) {
  const parts = Object.fromEntries(hdr.split(",").map((p) => p.split("=")));
  const t = Number(parts.t);
  if (!t || Math.abs(nowSec - t) > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const got = Buffer.from(parts.v1 || "", "hex");
  const want = Buffer.from(expected, "hex");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
assert.equal(verifyMailAgent(body, header, secretA, now), true);
assert.equal(verifyMailAgent(body, header, secretB, now), false);

console.log("webhook signature: ok");

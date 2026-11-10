/** GitHub Secret Scanning alerts: signature check (DER ECDSA P-256), parsing, owner notice. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  KEY_PATTERN,
  derToRawP256,
  leakNoticeEmail,
  maskKey,
  parseAlerts,
  verifyGithubSignature,
} from "../src/lib/github-secret-scanning";
import { newApiKey } from "../src/lib/key-signup";

const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
const other = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ type: "spki", format: "pem" }).toString();
const keys = [
  { key_identifier: "k-old", key: other, is_current: false },
  { key_identifier: "k-cur", key: pem, is_current: true },
];

const leaked = newApiKey();
assert.ok(KEY_PATTERN.test(leaked), "our keys match the pattern we register with GitHub");
const body = JSON.stringify([{ token: leaked, type: "mailagent_api_key", url: "https://github.com/x/y/blob/main/.env", source: "content" }]);

// Node signs EC as DER, like GitHub.
for (let i = 0; i < 20; i++) {
  const sig = crypto.sign("sha256", Buffer.from(body), privateKey).toString("base64");
  assert.equal(await verifyGithubSignature(body, sig, "k-cur", keys), true, "valid signature");
  assert.equal(await verifyGithubSignature(body + " ", sig, "k-cur", keys), false, "tampered body");
  assert.equal(await verifyGithubSignature(body, sig, "k-old", keys), false, "wrong key id");
}
assert.equal(await verifyGithubSignature(body, undefined, "k-cur", keys), false);
assert.equal(await verifyGithubSignature(body, "AAAA", "k-cur", keys), false);
assert.equal(await verifyGithubSignature(body, "x", "missing", keys), false);

// DER integers with a leading zero byte still give 64 raw bytes.
const der = new Uint8Array([0x30, 0x46, 0x02, 0x21, 0x00, ...new Array(32).fill(0xff), 0x02, 0x21, 0x00, ...new Array(32).fill(0x80)]);
const raw = derToRawP256(der)!;
assert.equal(raw.length, 64);
assert.equal(raw[0], 0xff);
assert.equal(raw[32], 0x80);
assert.equal(derToRawP256(new Uint8Array([0x31])), null);

assert.equal(parseAlerts(JSON.parse(body))!.length, 1);
assert.equal(parseAlerts({}), null);
assert.equal(parseAlerts([{ nope: 1 }]), null);

assert.equal(KEY_PATTERN.test("ma_short"), false);
assert.equal(maskKey(leaked), leaked.slice(0, 6) + "..." + leaked.slice(-4));
const mail = leakNoticeEmail(maskKey(leaked), "https://github.com/x/y", "https://webmailagent.com/get-key.html?replace");
assert.doesNotMatch(mail.text, new RegExp(leaked.slice(6, -4)), "notice never carries the full key");
assert.match(mail.text, /revoked/);
for (const t of [mail.subject, mail.text]) assert.doesNotMatch(t, /[—–·]/);

console.log("github secret scanning: ok");

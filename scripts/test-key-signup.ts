/** Self-serve key signup: email rules, tokens, hourly limiter */
import assert from "node:assert/strict";
import {
  confirmationEmail,
  isOwnInboxDomain,
  newApiKey,
  newSignupToken,
  normalizeSignupEmail,
  sha256Hex,
} from "../src/lib/key-signup";
import { hourlyLimitHit } from "../src/lib/hourly-limit";

assert.equal(normalizeSignupEmail("  QA@Acme.dev "), "qa@acme.dev");
assert.equal(normalizeSignupEmail("nope"), null);
assert.equal(normalizeSignupEmail(42), null);
assert.equal(normalizeSignupEmail(`${"a".repeat(250)}@b.io`), null);

assert.equal(isOwnInboxDomain("x@inbox.webmailagent.com", "inbox.webmailagent.com"), true);
assert.equal(isOwnInboxDomain("x@webmailagent.com", undefined), true);
assert.equal(isOwnInboxDomain("x@inbox.navorina.ai", undefined), true);
assert.equal(isOwnInboxDomain("x@custom-inbox.example", "custom-inbox.example"), true);
assert.equal(isOwnInboxDomain("x@acme.dev", "inbox.webmailagent.com"), false);
assert.equal(isOwnInboxDomain("x@notwebmailagent.com", undefined), false);

const token = newSignupToken();
assert.match(token, /^[A-Za-z0-9_-]{43}$/);
assert.notEqual(token, newSignupToken());
assert.match(newApiKey(), /^ma_[A-Za-z0-9_-]{32}$/);
assert.equal(
  await sha256Hex("abc"),
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
);

const mail = confirmationEmail("https://webmailagent.com/get-key.html#t=abc");
assert.match(mail.text, /get-key\.html#t=abc/);
assert.doesNotMatch(mail.text, /ma_/, "the key itself is never emailed");

const store = new Map<string, string>();
const kv = {
  get: async (k: string) => store.get(k) ?? null,
  put: async (k: string, v: string) => void store.set(k, v),
} as unknown as KVNamespace;
const pending: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) };
for (let i = 0; i < 3; i++) {
  assert.equal(await hourlyLimitHit(kv, ctx, "t:ip", 3), false);
  await Promise.all(pending);
}
assert.equal(await hourlyLimitHit(kv, ctx, "t:ip", 3), true);
assert.equal(await hourlyLimitHit(undefined, ctx, "t:ip", 3), false);

console.log("key signup: ok");

/** Abuse guard: who gets flagged, who gets suspended, how sender domains are counted. */
import assert from "node:assert/strict";
import { abuseVerdict, senderDomain, SUSPENDED_MESSAGE } from "../src/lib/abuse";

const base = { teamId: "t1", plan: "free", messages: 20, inboxes: 5 };

// Normal QA: a few senders.
assert.equal(abuseVerdict({ ...base, senderDomains: 3 }).level, "ok");
assert.equal(abuseVerdict({ ...base, senderDomains: 15 }).level, "ok");
// Free: many unrelated senders in a day.
assert.equal(abuseVerdict({ ...base, senderDomains: 16 }).level, "flag");
assert.equal(abuseVerdict({ ...base, senderDomains: 41 }).level, "suspend");
// Volume alone only flags.
assert.equal(abuseVerdict({ ...base, senderDomains: 2, messages: 301 }).level, "flag");
// Paid plans are never suspended automatically.
assert.equal(abuseVerdict({ ...base, plan: "pro", senderDomains: 45 }).level, "ok");
assert.equal(abuseVerdict({ ...base, plan: "pro", senderDomains: 500 }).level, "flag");
assert.equal(abuseVerdict({ ...base, plan: "enterprise", senderDomains: 150 }).level, "ok");
// Unknown plan counts as free.
assert.equal(abuseVerdict({ ...base, plan: "weird", senderDomains: 41 }).level, "suspend");
const v = abuseVerdict({ ...base, senderDomains: 41, messages: 400 });
assert.ok(v.level !== "ok" && v.reasons.length === 2);

assert.equal(senderDomain("Acme <no-reply@mail.acme.dev>"), "acme.dev");
assert.equal(senderDomain("security@acme.dev"), "acme.dev");
assert.equal(senderDomain("X <a@B.Example.COM.>"), "example.com");
assert.equal(senderDomain("no address"), null);
assert.equal(senderDomain("a@localhost"), null);

assert.match(SUSPENDED_MESSAGE, /hello@webmailagent\.com/);
assert.doesNotMatch(SUSPENDED_MESSAGE, /[—–·]/);

console.log("abuse: ok");

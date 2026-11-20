/** Keyless demo: real extraction on sample mail, nothing stored. */
import assert from "node:assert/strict";
import { buildDemoRun, resolveDemoScenario, DEMO_SCENARIOS } from "../src/lib/demo";

const fixed = () => 0.5;

assert.equal(resolveDemoScenario(undefined), "otp");
assert.equal(resolveDemoScenario("Magic_Link"), "magic_link");
assert.equal(resolveDemoScenario("drop table"), null);

const otp = buildDemoRun("otp", { rand: fixed, inboxDomain: "inbox.test" });
assert.equal(otp.demo, true);
assert.equal(otp.inbox.created, false);
assert.match(otp.inbox.address, /^demo-[a-z0-9]{4}@inbox\.test$/);
assert.equal(otp.verification.otp, "550000");
assert.deepEqual(otp.agent.primaryAction.type, "otp");
assert.equal(otp.agent.primaryAction.value, "550000");
assert.equal(otp.verification.confidence, "high");
// Unsubscribe links are noise, never the action.
assert.ok(!otp.verification.links.some((l) => /unsubscribe/.test(l)));

for (const s of ["magic_link", "password_reset", "invite"] as const) {
  const r = buildDemoRun(s, { rand: fixed });
  assert.equal(r.verification.otp, null, s);
  assert.equal(r.agent.primaryAction.type, "magic_link", s);
  assert.match(String(r.agent.primaryAction.value), /^https:\/\/staging\.acme\.dev\//, s);
  assert.ok(!/privacy/.test(String(r.agent.primaryAction.value)), s);
}

// Copy rules: no long dashes or middle dots.
for (const s of DEMO_SCENARIOS) {
  const r = buildDemoRun(s);
  assert.doesNotMatch(JSON.stringify(r), /[—·]/, s);
}
console.log("demo: ok");

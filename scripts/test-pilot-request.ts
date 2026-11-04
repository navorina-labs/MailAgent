/** Pilot request validation and email body */
import assert from "node:assert/strict";
import { pilotEmail, validatePilotRequest } from "../src/lib/pilot-request";

const ok = validatePilotRequest({
  email: " QA@Acme.dev ",
  company: "Acme",
  productUrl: "https://staging.acme.dev",
  flows: ["signup", "invite", "signup"],
  runner: "Playwright",
  message: "Signup OTP in CI",
});
assert.ok(ok.ok);
if (ok.ok) {
  assert.equal(ok.value.email, "qa@acme.dev");
  assert.deepEqual(ok.value.flows, ["signup", "invite"]);
  assert.equal(ok.spam, false);
  const mail = pilotEmail(ok.value);
  assert.equal(mail.subject, "Mail Agent pilot request: Acme");
  assert.match(mail.text, /Flows: signup, invite/);
}

const minimal = validatePilotRequest({ email: "a@b.io" });
assert.ok(minimal.ok);

assert.deepEqual(validatePilotRequest({ email: "nope" }), { ok: false, error: "invalid_email", field: "email" });
assert.deepEqual(validatePilotRequest({}), { ok: false, error: "invalid_email", field: "email" });
assert.deepEqual(validatePilotRequest(null), { ok: false, error: "invalid_body" });
assert.deepEqual(validatePilotRequest([]), { ok: false, error: "invalid_body" });
assert.deepEqual(validatePilotRequest({ email: "a@b.io", flows: ["mass_signup"] }), {
  ok: false,
  error: "invalid_flows",
  field: "flows",
});
assert.deepEqual(validatePilotRequest({ email: "a@b.io", productUrl: "javascript:alert(1)" }), {
  ok: false,
  error: "invalid_product_url",
  field: "productUrl",
});
assert.deepEqual(validatePilotRequest({ email: "a@b.io", message: "x".repeat(1001) }), {
  ok: false,
  error: "field_too_long",
  field: "message",
});
assert.deepEqual(validatePilotRequest({ email: "a@b.io", name: 42 }), {
  ok: false,
  error: "field_too_long",
  field: "name",
});

const bot = validatePilotRequest({ email: "a@b.io", website: "http://spam.example" });
assert.ok(bot.ok && bot.spam);

console.log("pilot request: ok");

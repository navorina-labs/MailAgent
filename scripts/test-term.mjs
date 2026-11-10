/** /term: command parsing, primary action priority, copy rules. No network. */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../public/term.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/term.html", import.meta.url), "utf8");
const sandbox = { module: { exports: {} } };
vm.runInNewContext(src, sandbox);
const term = sandbox.module.exports;

assert.deepEqual(JSON.parse(JSON.stringify(term.parseLine("new signup-test"))), { name: "new", args: ["signup-test"] });
assert.deepEqual(JSON.parse(JSON.stringify(term.parseLine('  NEW "ci run 42" '))), { name: "new", args: ["ci run 42"] });
assert.equal(term.parseLine("").name, "");

assert.equal(term.primaryAction({ otp: "482910", primaryLink: "https://x.test/v" }).type, "otp");
assert.equal(term.primaryAction({ otp: null, primaryLink: "https://x.test/v", links: [] }).value, "https://x.test/v");
assert.equal(term.primaryAction({ otp: null, primaryLink: null, links: ["https://x.test/a"] }).type, "link");
assert.equal(term.primaryAction({ otp: null, primaryLink: null, links: [] }).type, "manual");

assert.deepEqual([...term.completions("w")], ["whoami", "wait"]);
assert.match(term.errorText(401, {}), /^Key rejected\. Paste a valid key/);
assert.match(term.errorText(429, { error: "inbox_limit_reached" }), /Inbox limit/);
assert.match(term.errorText(408, { error: "timeout" }), /No email yet/);

// Lines typed while a command runs are queued and run in order, never dropped.
{
  const ran = [];
  let release;
  const q = term.createQueue(async (line) => {
    ran.push("start " + line);
    if (line === "wait") await new Promise((r) => (release = r));
    ran.push("end " + line);
  });
  const done = q.push("wait");
  q.push("sim otp");
  q.push("mail");
  assert.equal(q.pending, 2);
  assert.equal(q.running, true);
  release();
  await done;
  assert.deepEqual(ran, ["start wait", "end wait", "start sim otp", "end sim otp", "start mail", "end mail"]);
  assert.equal(q.running, false);

  // ctrl+c drops lines that have not started.
  let release2;
  const q2 = term.createQueue(async (line) => { if (line === "wait") await new Promise((r) => (release2 = r)); ran.push(line); });
  const d2 = q2.push("wait");
  q2.push("read");
  assert.equal(q2.clear(), 1);
  release2();
  await d2;
  assert.equal(ran.at(-1), "wait");
}

// A key is saved only when the server accepts it.
assert.equal(term.keyCheckDecision(200), "save");
assert.equal(term.keyCheckDecision(401), "reject");
assert.equal(term.keyCheckDecision(403), "reject");
assert.equal(term.keyCheckDecision(503), "unchecked");
assert.equal(term.keyCheckDecision(429), "unchecked");

// A pasted key alone is the key command, case kept; keys are never printed in full.
{
  const k = "ma_PSdTycPhQl0en3LhUnGw0-Ht5hTyMy6o";
  const r = JSON.parse(JSON.stringify(term.resolveLine("  " + k + " ")));
  assert.deepEqual(r, { name: "key", args: [k] });
  assert.equal(term.resolveLine("new x").name, "new");
  assert.equal(term.maskKeys("unknown " + k), "unknown ma_PSd...My6o");
  assert.equal(term.maskKeys(k.toLowerCase()), "ma_psd...my6o");
  assert.doesNotMatch(term.maskKeys("x " + k + " y"), /Ql0en3/);
}

// Every command has a handler.
for (const [name] of term.COMMANDS) {
  assert.match(src, new RegExp(`(^|\\s|")${name.replace("-", "\\-")}"?\\(`, "m"), `handler for ${name}`);
}

// Copy rules: no long dashes or middle dots in user-facing files.
for (const [file, text] of [["term.html", html], ["term.js", src]]) {
  assert.doesNotMatch(text, /[—–·]/, `${file}: no long dashes or middle dots`);
}
// Only the existing public API, same host as the other pages.
assert.match(html, /data-api="https:\/\/api\.webmailagent\.com"/);
assert.doesNotMatch(src, /innerHTML/, "render with textContent only");

console.log("term: ok");

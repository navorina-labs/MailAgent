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
assert.equal(term.errorText(401, {}), "Key rejected. Run: key ma_...");
assert.match(term.errorText(429, { error: "inbox_limit_reached" }), /Inbox limit/);
assert.match(term.errorText(408, { error: "timeout" }), /No email yet/);

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

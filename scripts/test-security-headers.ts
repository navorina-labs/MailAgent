/** Pages that show an API key: strict CSP, no third-party scripts, no framing anywhere. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { KEY_PAGE_CSP, isKeyPage, securityHeadersFor, withSecurityHeaders } from "../src/lib/security-headers";

for (const p of ["/term", "/term.html", "/get-key", "/get-key.html"]) {
  assert.equal(isKeyPage(p), true, p);
  assert.equal(securityHeadersFor(p)["Content-Security-Policy"], KEY_PAGE_CSP);
}
for (const p of ["/", "/index.html", "/upgrade.html", "/docs/agents.html"]) {
  assert.equal(isKeyPage(p), false, p);
  assert.equal(securityHeadersFor(p)["Content-Security-Policy"], "frame-ancestors 'none'");
  assert.equal(securityHeadersFor(p)["X-Frame-Options"], "DENY");
}
assert.match(KEY_PAGE_CSP, /script-src 'self'(;|$)/);
assert.match(KEY_PAGE_CSP, /connect-src 'self' https:\/\/api\.webmailagent\.com/);
assert.match(KEY_PAGE_CSP, /frame-ancestors 'none'/);

// Existing headers win; the body passes through.
const res = withSecurityHeaders(new Response("ok", { headers: { "X-Frame-Options": "SAMEORIGIN" } }), "/term");
assert.equal(res.headers.get("X-Frame-Options"), "SAMEORIGIN");
assert.equal(res.headers.get("Content-Security-Policy"), KEY_PAGE_CSP);
assert.equal(await res.text(), "ok");

// Key pages load only first-party scripts, and nothing inline.
for (const page of ["term.html", "get-key.html"]) {
  const html = readFileSync(new URL(`../public/${page}`, import.meta.url), "utf8");
  for (const [, src] of html.matchAll(/<script[^>]*src="([^"]+)"/g)) {
    assert.ok(src.startsWith("/"), `${page}: third-party script ${src}`);
  }
  assert.doesNotMatch(html, /<script>/, `${page}: inline script`);
  assert.doesNotMatch(html, /googletagmanager/, `${page}: analytics`);
}

// The key leaves /get-key after a short time.
const js = readFileSync(new URL("../public/get-key.js", import.meta.url), "utf8");
assert.match(js, /const VISIBLE_SECONDS = 300;/);
assert.match(js, /const AFTER_COPY_SECONDS = 30;/);

console.log("security headers: ok");

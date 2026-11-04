/** Worker API vs static asset routing */
import assert from "node:assert/strict";
import { isApiPath } from "../src/lib/api-path";

for (const path of ["/health", "/v1", "/v1/agent", "/v1/pilot-requests", "/webhooks/resend", "/mcp", "/mcp/auth", "/.well-known/oauth-authorization-server"]) {
  assert.equal(isApiPath(path), true, path);
}
for (const path of ["/", "/mcp-signup-qa", "/mcp-signup-qa.html", "/v1-notes", "/webhooksx", "/healthz", "/docs/agents.html", "/privacy.html"]) {
  assert.equal(isApiPath(path), false, path);
}
console.log("api path: ok");

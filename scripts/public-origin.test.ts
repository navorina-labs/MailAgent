import assert from "node:assert/strict";
import test from "node:test";
import {
  LEGACY_API_ORIGIN,
  LEGACY_WORKSPACE_ORIGIN,
  NAVORINA_API_ORIGIN,
  NAVORINA_WORKSPACE_ORIGIN,
  isInsecureRequest,
  publicApiOrigin,
  publicOriginFromUrl,
  resolveWorkspaceReturnTo,
  workspaceOrigin,
  workspaceUrl,
} from "../src/lib/public-origin";

test("trusted proxy scheme takes precedence over the local request URL", () => {
  assert.equal(
    isInsecureRequest(
      new Request("http://127.0.0.1:8787/health", {
        headers: { "X-Forwarded-Proto": "https" },
      })
    ),
    false
  );
  assert.equal(
    isInsecureRequest(
      new Request("https://mail-api.navorina.ai/health", {
        headers: { "X-Forwarded-Proto": "http" },
      })
    ),
    true
  );
});

test("uses the request host for custom production domains", () => {
  assert.equal(
    publicOriginFromUrl(`${NAVORINA_API_ORIGIN}/health`),
    NAVORINA_API_ORIGIN
  );
});

test("explicit API origin overrides a public request host", () => {
  assert.equal(
    publicOriginFromUrl("https://worker.example/health", NAVORINA_API_ORIGIN),
    NAVORINA_API_ORIGIN
  );
});

test("local and workers.dev requests remain self-describing", () => {
  assert.equal(
    publicOriginFromUrl("http://127.0.0.1:8787/health", NAVORINA_API_ORIGIN),
    "http://127.0.0.1:8787"
  );
  assert.equal(
    publicOriginFromUrl("https://mailagent.example.workers.dev/health", NAVORINA_API_ORIGIN),
    "https://mailagent.example.workers.dev"
  );
});

test("legacy origins remain compatibility fallbacks", () => {
  assert.equal(publicApiOrigin(), LEGACY_API_ORIGIN);
  assert.equal(workspaceOrigin(), LEGACY_WORKSPACE_ORIGIN);
});

test("workspace links and relative OAuth returns use configured origin", () => {
  assert.equal(
    workspaceUrl("/docs/agents.html", NAVORINA_WORKSPACE_ORIGIN),
    `${NAVORINA_WORKSPACE_ORIGIN}/docs/agents.html`
  );
  assert.equal(
    resolveWorkspaceReturnTo(
      "/dashboard.html",
      `${NAVORINA_API_ORIGIN}/v1/workspace/gmail/callback`,
      NAVORINA_WORKSPACE_ORIGIN,
      NAVORINA_API_ORIGIN
    ).toString(),
    `${NAVORINA_WORKSPACE_ORIGIN}/dashboard.html`
  );
});

test("invalid configured origins fail closed to known fallbacks", () => {
  assert.equal(publicApiOrigin("javascript:alert(1)"), LEGACY_API_ORIGIN);
  assert.equal(workspaceOrigin("not a URL"), LEGACY_WORKSPACE_ORIGIN);
});

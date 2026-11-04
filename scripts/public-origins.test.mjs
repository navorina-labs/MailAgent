import assert from "node:assert/strict";
import test from "node:test";
import {
  LEGACY_API_ORIGIN,
  LEGACY_WORKSPACE_ORIGIN,
  NAVORINA_API_ORIGIN,
  NAVORINA_WORKSPACE_ORIGIN,
  apiOrigin,
  apiUrl,
  workspaceOrigin,
  workspaceUrl,
} from "./lib/public-origins.mjs";

test("operational scripts keep the legacy API until cutover", () => {
  assert.equal(apiOrigin({}), LEGACY_API_ORIGIN);
  assert.equal(workspaceOrigin({}), LEGACY_WORKSPACE_ORIGIN);
});

test("MAILAGENT_API_URL has priority over Worker origin configuration", () => {
  assert.equal(
    apiOrigin({
      MAILAGENT_API_URL: "https://preview.example/path",
      MAILAGENT_PUBLIC_API_ORIGIN: NAVORINA_API_ORIGIN,
    }),
    "https://preview.example"
  );
});

test("Navorina API selection implies the Navorina workspace", () => {
  const env = { MAILAGENT_PUBLIC_API_ORIGIN: NAVORINA_API_ORIGIN };
  assert.equal(apiOrigin(env), NAVORINA_API_ORIGIN);
  assert.equal(workspaceOrigin(env), NAVORINA_WORKSPACE_ORIGIN);
  assert.equal(apiUrl("/health", env), `${NAVORINA_API_ORIGIN}/health`);
  assert.equal(workspaceUrl("/docs/agents.html", env), `${NAVORINA_WORKSPACE_ORIGIN}/docs/agents.html`);
});

test("explicit workspace configuration wins", () => {
  assert.equal(
    workspaceOrigin({ MAILAGENT_WORKSPACE_ORIGIN: "https://docs.example/path" }),
    "https://docs.example"
  );
});

test("unsafe configuration falls back", () => {
  assert.equal(apiOrigin({ MAILAGENT_API_URL: "javascript:alert(1)" }), LEGACY_API_ORIGIN);
  assert.equal(
    workspaceOrigin({ MAILAGENT_WORKSPACE_ORIGIN: "not a URL" }),
    LEGACY_WORKSPACE_ORIGIN
  );
});

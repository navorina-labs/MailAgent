/** 401 bodies point people and agents to a free key, and keep error=unauthorized for old clients. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unauthorizedBody, GET_KEY_URL } from "../src/lib/auth-error";
import { isApiPath } from "../src/lib/api-path";

const missing = unauthorizedBody(false);
assert.equal(missing.error, "unauthorized");
assert.equal(missing.reason, "missing_api_key");
assert.equal(missing.getKey, GET_KEY_URL);
assert.match(missing.message, /Bearer ma_/);

const invalid = unauthorizedBody(true);
assert.equal(invalid.error, "unauthorized");
assert.equal(invalid.reason, "invalid_api_key");

// llms.txt is a static file, not an API path, and follows the copy rules.
assert.equal(isApiPath("/llms.txt"), false);
const llms = readFileSync(new URL("../public/llms.txt", import.meta.url), "utf8");
assert.match(llms, /^# Mail Agent/);
assert.match(llms, /get-key/);
assert.doesNotMatch(llms, /[—–·]/);

console.log("auth-error: ok");

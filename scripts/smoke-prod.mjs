#!/usr/bin/env node
/** Smoke against prod API (requires MAILAGENT_API_URL + MAILAGENT_API_KEY) */
import "./load-env.mjs";
import { apiOrigin } from "./lib/public-origins.mjs";

const base = apiOrigin();
const apiKey = process.env.MAILAGENT_API_KEY ?? process.env.API_KEY;

if (!apiKey) {
  console.error("Set MAILAGENT_API_KEY");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json",
};

async function get(path) {
  const res = await fetch(`${base}${path}`, { headers });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

async function main() {
  console.log("Smoke prod →", base);

  for (const path of ["/health", "/v1", "/v1/stats", "/v1/agent"]) {
    const { res, json } = await get(path);
    console.log(path, res.status, JSON.stringify(json).slice(0, 120));
    if (!res.ok) process.exit(1);
  }

  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

#!/usr/bin/env node
/** Print copy-paste pilot invite (no secrets) — docs/PILOT-INVITE.md */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const slug = process.argv[2] ?? "acme-pilot";
const teamLabel = slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const template = readFileSync(join(root, "docs/PILOT-INVITE.md"), "utf8");
const block = template.split("## Email / Slack template")[1]?.split("## After")[0] ?? "";

console.log(`Pilot invite — ${slug} (${teamLabel})\n`);
console.log("─".repeat(60));
console.log(block.replace(/ACME/g, teamLabel).replace(/acme-pilot/g, slug).trim());
console.log("─".repeat(60));
console.log(`
The team creates its own Free key at https://webmailagent.com/get-key.
Track status in docs/PILOT-CANDIDATES.md. Guide: docs/PILOT-ONBOARD.md
`);

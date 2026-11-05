#!/usr/bin/env node
/** Export lean run bundle for AI-Context-OS experiments/mailagent/runs/ */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  let resultsDir = null;
  let outDir = null;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--out" && argv[i + 1]) outDir = argv[++i];
    else if (!argv[i].startsWith("-")) resultsDir = argv[i];
  }
  if (!resultsDir) {
    const base = path.join(__dirname, "results");
    const dirs = fs
      .readdirSync(base)
      .filter((d) => d.startsWith("run-"))
      .map((d) => path.join(base, d))
      .filter((d) => fs.existsSync(path.join(d, "summary.json")))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    resultsDir = dirs[0];
  }
  if (!resultsDir) {
    console.error("Usage: node export-results.mjs <results-dir> [--out DIR]");
    process.exit(1);
  }
  const runName = path.basename(resultsDir);
  outDir = outDir ?? path.join(__dirname, "export", runName);
  return { resultsDir, outDir, runName };
}

function copyIfExists(src, dest) {
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    return true;
  }
  return false;
}

function slimResults(resultsPath) {
  const rows = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
  return rows.map((r) => ({
    question_id: r.question_id,
    domain: r.domain,
    condition: r.condition,
    accuracy: r.accuracy,
    hallucination: r.hallucination,
    completeness: r.completeness,
    reasoning: r.reasoning,
    latency_ms: r.latency_ms,
    tokens_in: r.tokens_in,
    tokens_out: r.tokens_out,
    context_chars: r.context_chars,
    tokens_in_context_est: r.tokens_in_context_est,
    cores_used: r.cores_used,
    error: r.error,
  }));
}

function main() {
  const { resultsDir, outDir, runName } = parseArgs(process.argv);
  fs.mkdirSync(outDir, { recursive: true });

  const copies = [
    "summary.json",
    "tokens-summary.json",
    "SUMMARY.md",
    "TOKENS.md",
    "ABC-COMPARE.md",
    "FINAL.md",
    "paired.csv",
    "tokens-paired.csv",
    "run-meta.json",
    "context-a-meta.json",
  ];

  for (const name of copies) {
    copyIfExists(path.join(resultsDir, name), path.join(outDir, name));
  }

  const resultsJson = path.join(resultsDir, "results.json");
  if (fs.existsSync(resultsJson)) {
    fs.writeFileSync(
      path.join(outDir, "results.json"),
      JSON.stringify(slimResults(resultsJson), null, 2)
    );
  }

  for (const name of fs.readdirSync(resultsDir)) {
    if (/^MA\d+-[ABC]\.md$/.test(name)) {
      fs.copyFileSync(path.join(resultsDir, name), path.join(outDir, name));
    }
  }

  const summaryPath = path.join(outDir, "summary.json");
  if (fs.existsSync(summaryPath)) {
    const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
    const metaPath = path.join(outDir, "run-meta.json");
    const prev = fs.existsSync(metaPath)
      ? JSON.parse(fs.readFileSync(metaPath, "utf8"))
      : {};
    fs.writeFileSync(
      metaPath,
      JSON.stringify(
        {
          ...prev,
          exported_at: new Date().toISOString(),
          paired_questions: summary.paired_questions,
          conditions: summary.conditions,
          model: prev.model ?? "gpt-4o-mini",
          source_repo: "navorina-labs/MailAgent",
          mailagent_commit: process.env.MAILAGENT_COMMIT ?? null,
        },
        null,
        2
      )
    );
  }

  const manifest = {
    run_id: runName,
    exported_at: new Date().toISOString(),
    source_repo: "navorina-labs/MailAgent",
    source_path: `context-os/eval/results/${runName}`,
    mailagent_commit: process.env.MAILAGENT_COMMIT ?? null,
    files: fs.readdirSync(outDir).sort(),
  };
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`Exported ${outDir} (${manifest.files.length} files)`);
  console.log(outDir);
}

main();

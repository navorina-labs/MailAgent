# Context OS — automated A/B evaluation

Замер **A / B / C** на одном `questions.json`:

| Condition | Стратегия |
|-----------|-----------|
| **A** | Full repo baseline (`baseline-manifest.json`) |
| **B** | Context OS routed cores |
| **C** | Hermes-style graph (`context-os/graph/`) — subgraph + snippets |

Протокол: [AI-Context-OS](https://github.com/Alex0nder/AI-Context-OS).

Результаты пишутся в `context-os/eval/results/` — можно **pull из MailAgent git** в окне AI-Context-OS.

## Требования

```bash
# Корневой .env (gitignored) — подхватывается автоматически:
OPENAI_API_KEY=sk-...

# Или в shell:
export OPENAI_API_KEY=sk-...
export EVAL_MODEL=gpt-4o-mini         # опционально
export OPENAI_BASE_URL=https://...    # OpenAI-compatible (опционально)
```

## Быстрый старт (из клона MailAgent)

```bash
git clone https://github.com/navorina-labs/MailAgent.git
cd MailAgent

# 1) Router only (без LLM, ~1 сек)
npm run eval:context-os:route

# 2) Dry-run — только размеры контекста
npm run eval:context-os:dry

# 3) Собрать graph index (Condition C)
npm run eval:context-os:graph-build

# 4) Dry-run размеров A/B/C (pilot, без API)
npm run eval:context-os:dry-abc

# 5) Pilot A/B/C (10 вопросов, платный API)
npm run eval:context-os:pilot

# 6) Сводка + токены
npm run eval:context-os:aggregate -- context-os/eval/results/run-<id>
npm run eval:context-os:tokens -- context-os/eval/results/run-<id>
```

## Pull results в AI-Context-OS (другое окно)

```bash
# В репозитории AI-Context-OS
mkdir -p experiments/mailagent/runs
cd experiments/mailagent/runs

# Обновить клон MailAgent и скопировать последний run
git clone https://github.com/navorina-labs/MailAgent.git _mailagent 2>/dev/null || git -C _mailagent pull
LATEST=$(ls -td _mailagent/context-os/eval/results/run-* 2>/dev/null | head -1)
cp -R "$LATEST" ./$(basename "$LATEST")
cat ./$(basename "$LATEST")/SUMMARY.md
```

Или sparse checkout только eval (быстрее):

```bash
git clone --filter=blob:none --sparse https://github.com/navorina-labs/MailAgent.git _mailagent
git -C _mailagent sparse-checkout set context-os/eval
```

**Важно:** Condition B — `--router gold|keyword|semantic` (default: `keyword`). Gold = oracle `expected_cores`; keyword/semantic = production routers. Router F1 пишется в `run-meta.json`. Stage-0 F1 без LLM: `eval:context-os:route` / `:route-semantic`.

### Экспорт в AI-Context-OS

```bash
npm run eval:context-os:export -- context-os/eval/results/run-<id>
cp -R context-os/eval/export/run-<id> \
  ../AI-Context-OS/experiments/mailagent/runs/
```

Публикуется lean bundle: `summary.json`, `results.json` (без полных ответов), `ABC-COMPARE.md`, `paired.csv`, per-question `MA*-{A,B,C}.md`.

## Команды

| Script | Что делает |
|--------|------------|
| `npm run eval:context-os:route` | Routing F1 vs gold cores |
| `npm run eval:context-os:graph-build` | Индекс графа для Condition C |
| `npm run eval:context-os:dry-abc` | Размеры A/B/C без API (pilot) |
| `npm run eval:context-os:pilot` | A/B/C + judge, MA01–MA10 |
| `npm run eval:context-os` | A/B/C все 35 вопросов |
| `npm run eval:context-os:aggregate -- <dir>` | CCR, accuracy, SUMMARY.md |
| `npm run eval:context-os:tokens -- <dir>` | Токены и $ по A/B/C |

### Добавить C к уже прогнанным A/B

```bash
node context-os/eval/run-eval.mjs --condition c --merge context-os/eval/results/run-<id>
npm run eval:context-os:aggregate -- context-os/eval/results/run-<id>
```

### Ручной запуск

```bash
node context-os/eval/run-eval.mjs --pilot --condition both
node context-os/eval/run-eval.mjs --ids MA01,MA03 --skip-judge
node context-os/eval/aggregate.mjs context-os/eval/results/run-1730000000000
```

## Выходные файлы

```
context-os/eval/results/run-<timestamp>/
├── run-meta.json
├── context-a-meta.json
├── results.csv          # все прогоны
├── paired.csv           # после aggregate
├── summary.json
├── SUMMARY.md           # human-readable
├── MA01-A.md
└── MA01-B.md
```

## Метрики

| Metric | Источник |
|--------|----------|
| CCR | `context_chars_A / context_chars_B` |
| Accuracy 0–3 | LLM judge vs `questions.json` gold |
| Hallucination | judge boolean |
| Latency | wall-clock per answer |
| Routing F1 | `route-eval.mjs` |

## Файлы

- `questions.json` — 35 вопросов + gold bullets
- `baseline-manifest.json` — что входит в Condition A (без `context-os/`)
- `lib/` — router, context loader, LLM, judge

## Стоимость (оценка)

Pilot 10 × 2 conditions × (answer + judge) ≈ 40 API calls.  
При `gpt-4o-mini` — порядка $0.05–0.30 в зависимости от размера baseline.

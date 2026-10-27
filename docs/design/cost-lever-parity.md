# Cost-lever parity — end state (2026-10-26)

Source: TIP Code comparison audit (ROADMAP "Cost-lever parity — TIP Code comparison"). This file is the
contract the five workstreams build against. Each workstream owns its files; a file owned by another
stream is edited only minimally and re-read before every edit. Other sessions have uncommitted edits in
`packages/run-policy/src/policy.ts` and `brain-embedded/src/runStore/*` — build on top, never revert.

## WS-R  Routing, stages, spend (owner: routing agent)

- **Stage models.** One resolver `stageModels(settings, env)` → `{ plan?, code?, verify?, subagent?, quick? }`.
  Sources in order: VS Code settings `builderforce.models.{plan,code,review,subagent}` → `ROLE_MODELS` env →
  unset (gateway orders by role). `RunPolicyOptions.phaseModels.{plan,code,verify}` are ALL read by
  `nextTurn`; the VSIX passes them instead of pinning the `code` model to the whole run. `modelForChildRun`
  uses `subagent`.
- **Pipeline router.** Pure package `@builderforce/pipeline-route` (no I/O): `scorePipeline(features) →
  { score, route: 'full' | 'quick', reason }`, logistic over weighted features (`ROUTE_WEIGHTS`), threshold
  default 0.5, `mode: 'auto' | 'always'`, phrase "full pipeline" forces full. `quick` = start in `code`, no
  plan phase, no verify stage, model = `quick` stage model. Decided once per run in the run preamble.
- **Ledger.** Local `RunUsageValue` gains `role`, `pipelineRoute`, `routeScore` (the existing `route`
  field — transport local/gateway/byo — keeps its meaning, documented). Server `llm_usage_log` gains
  `pipeline_route`, `route_score` in BOTH migration tracks (expand only).
- **Route report.** VS Code command `builderforce.pipelineRouteReport` over the local ledger, N=30 days:
  runs per route, cost per route, score histogram, misroute proxy (quick runs later re-run full / failed),
  suggested threshold. Cloud cost metrics gain `model` and `route` groupings.
- **Per-run USD cap.** Setting `builderforce.maxRunBudgetUsd` (0 = off). The run store checks the run's
  accumulated cost before every turn and stops with a contained outcome; warns the model at 80%, like the
  cloud `runBudget`. One shared budget primitive for cloud and run store (extract, don't copy).
- Difficulty/local-skip thresholds become overridable options with the current constants as defaults.
  The dead `spendMillicents: 0` in the cloud tool-time containment check is removed.

## WS-L  Local levers in the VSIX (owner: local-levers agent)

- C8 compression live: VSIX uses `catalogDesktopSemantic`. On-device hosts resolve rollout levers by a
  stable install id bucket (not a null tenant ⇒ always off).
- `read_compressed` tool (file path → LLMLingua-2 compressed prose; refuses code files) registered when the
  compress capability is live. `compressProse(text, kind)` exported for WS-I.
- `local_research` tool: a LOCAL model (hybrid local tier: bfi-node/Synapse → Ollama) reads named files /
  search hits and answers the paid model's question. Answer cache keyed by (question, file set) and
  invalidated by file mtimes+sizes, not TTL. Deterministic pre-search (symbol index + ripgrep) feeds its prompt.
  Time limit returns the deterministic hits as a partial success.
- Deterministic pre-search before turn 1: identifiers in the request → symbol index + rg → a bounded hits
  block in the run's context pack. "Where is X defined / where is X" answered with no model call when the
  symbol index resolves every identifier.
- Repo map: tree-sitter (web-tree-sitter WASM; TS/JS, Python, PHP, C#, Go, Rust, Java where grammars load)
  in the VSIX symbol index with the regex extractor as fallback; `repo_map` tool served from the local index
  without Desktop. `rescanCodebase` refreshes the index without a model route. Watcher honours skipDirs and
  ignores `.builderforce/`. Stop aborts ripgrep; search is smart-case.

## WS-M  Code maps (owner: memory agent)

- builderforce-memory `consolidate`: the 3-file minimum applies to every run; root files map to a
  recallable area. Package README + CHANGELOG document the `volatileTail` / `<run-state>` cache rule.
- `projectFactsWrite`: retiring prior facts is scoped to the SAME key; merged maps carry the union of anchors.
- Staleness: a changed anchor drops that file from the map at recall, it does not hide the whole map.
- Area recall from request text (identifiers → symbol index → dirs, plus area-name match) in the VSIX; an
  area-targeted codemap recall in the shared run-context source for cloud and on-prem; the Claude Agent SDK
  (V2) runner records knowledge and writes maps.

## WS-C  Prompt cache (owner: cache agent)

- OpenRouter-Anthropic history breakpoint lands on the last STABLE message including tool turns.
- Every per-turn block (forced brief included) is `<run-state>`-tagged and last.
- packHandoff result is memoised per run and re-packed only on overflow; drop-oldest windowing drops in
  chunks (hysteresis) so the prefix moves rarely.
- `getStableGrounding` is computed once per rescan. Workforce recall moves out of the system prompt.
  Tool pins append, never evict a fixed tool mid-run. Thinking setting constant across a run's turns.

## WS-I  Context ingress (owner: ingress agent, after WS-L)

- Attachments reach the model in VS Code: text attachments and "Add context" are inlined into the turn under
  a mention budget; binaries upload through the host (`signedUploadUrl` implemented in the VS Code adapter).
- Mention budget primitive in `@builderforce/tool-output-policy`: `mentionBudget(target: 'cloud' | 'local')`.
- Prose attachments (.md .txt .log .rst .adoc) over `minChars` compressed via `compressProse`; code never.
- `#file` references from the VS Code chat participant are read and inlined under the same budget.
- Images: settings `builderforce.images.{maxEdge,jpegQuality}`; small PNGs / transparency / GIF kept as-is.

## Done checks

Each stream: targeted typecheck + its own tests green (Sonnet), existing tests unchanged, no new god file
(>400 lines), settings declared in `clients/vscode/package.json` are read, i18n for any new UI string.

# 11 — PRD: Agent Engine Consolidation (one contract, one engine seam, four surfaces)

**Status: V1 + LOCAL RETIRED ✅ (V1 2026-06-13; `builderforce-local` deleted as dead code
2026-06-14 per operator decision §5.5(a)). `builderforce-v2` is now the SOLE runner and the
consolidated default on every surface. The whole unselectable Node shared-registry engine —
`LocalAgentEngine`, `node-capability-provider`, `buildNodeToolRegistry`, the 14 duplicate
`build*ToolDef` `ToolDefinition` wrappers, and the orphaned `createNodeWebSearch` — was removed
(the `run*` pure backends stay; they back the live native `create*Tool` `AgentTool`s). The
dormant V1 `pendingTaskRun`/`flushPendingTaskChanges` is also gone. All 4 packages `tsc` 0; zero
dangling refs. On-prem pi-removal ~95% (3 of 4 deps deleted; runtime pi-free; only `pi-tui`
remains). Remaining V1 tail is deploy-gated dead-code (cloud V1 dispatch branch — see §5.5).**
Umbrella PRD for the program that collapses Builderforce's
formerly-forked agent runtimes into **one tool contract + one swappable engine seam**,
runnable on every surface. The on-prem `@mariozechner/pi-*` removal — the largest single
slice — has its own staged plan in [10-prd-pi-cutover.md](10-prd-pi-cutover.md); this
doc is the feature-level source of truth: what the consolidation *is*, what is *done*,
and every **remaining capability** still to implement across all surfaces.

**Operator decisions carried in (2026-06-13):** retire V1 entirely; one surface-agnostic
engine with **full tool parity on every surface — no reduced tool set anywhere**; new
runners join via **interfaces + dependency injection** (a registry entry, never a new
dispatch branch); per-surface differences are **injected dependencies**, not forked engines.
**Clarified 2026-06-13 (pass 13):** the on-prem target is **V1 retired, the native engine
serving the full ~40-tool set** — the default must NOT regress to a reduced set. **Resolved
2026-06-14 (§5.5(a)):** that native engine is the **native embedded runner** (Claude-SDK
`builderforce-v2`), which already carries the full ~40-tool native `AgentTool` set (service/media
included). The alternative — making `builderforce-local` the default and wiring
`buildNodeToolRegistry` WITH its `NodeServiceToolDeps` bag — is moot: `builderforce-local` was
deleted as dead code (it was never selectable), so that whole registry layer is gone.

> **STATUS UPDATE 2026-06-13 (this pass): the on-prem `pi-*` removal is ~95% done — 3 of 4
> deps deleted.** `@mariozechner/pi-agent-core`, `pi-coding-agent`, and `pi-ai` are at **0
> source imports and removed from `agent-runtime/package.json`**; `agent-runtime` `tsgo` is
> **0**; ~80 native/migrated unit tests pass. The on-prem agent runtime — the embedded
> runner (`runEmbeddedPiAgent`/`attempt.ts`, which `runV1Engine` dispatches to via
> `chat.send`), the agent loop, file tools, skills, extensions, compaction, the model layer,
> every completion/vision site, and the OAuth/Codex subsystem — is **pi-free**. **Only
> `@mariozechner/pi-tui` remains** (Stage 4 — the interactive CLI's TUI framework, 18 sites).
> See §4 (Done) and §5.1 (Remaining) below for the corrected detail.

---

## 1. Problem

The same "run a model + tools to complete a task" loop existed three+ times, each with its
own tool list and its own hard-coded V1/V2 branch:

- **Cloud (Worker/DO)** ran a bespoke tool loop with a **hand-written JSON-Schema** tool array.
- **Cloud Container** advertised a **second** hand-written array to its in-image loop.
- **On-prem (Hosted)** ran the **`@mariozechner/pi-*`** agent loop with ~40 **TypeBox**-schema
  pi `AgentTool`s.

Three schema dialects (JSON Schema × TypeBox × hand-written), three tool registries, and the
V1-vs-V2 decision duplicated at every dispatch site. Adding a tool meant editing 2–3 lists;
adding a runtime meant a new `if`. This is the divergence the consolidation removes.

## 2. Goals / non-goals

**Goals**
- **One tool contract.** A single `ToolDefinition` shape, defined once, capability-gated,
  consumed verbatim by every surface. Adding a tool = one `register()`; it appears on every
  surface that backs its capability.
- **One engine seam.** An `AgentEngine` interface resolved by id from a registry (DI).
  Swapping/adding a runner is a registry entry; retiring one is deleting its entry.
- **Full parity, no reduced sets.** Every surface offers every tool it can physically back —
  surfaces differ only by *capability*, never by a curated allow-list.
- **Retire V1** (both the cloud `builderforce-v1` gateway-default path and the on-prem pi loop)
  once parity is proven, behind the seam so it can be exercised in parallel before the flip.

**Non-goals**
- New product capabilities. This is a like-for-like unification; the only intentional behavior
  change is the on-prem model path moving direct-provider → gateway (locked decision).
- Re-architecting orchestration/workflows themselves — only their exposure as shared tools.

## 3. Architecture — the three pillars

### 3.1 Shared contract — `@builderforce/agent-tools` (`packages/agent-tools`)
Runtime-agnostic; no `node:*`, no Cloudflare `Env`, no `pi-*`. Imported verbatim by both
`api` (Worker) and `agent-runtime` (Node).

- `Capability` (capabilities.ts) — the surface↔tool gating vocabulary: `repo.read`,
  `repo.search`, `repo.write`, `repo.edit`, `repo.delete`, `shell`, `process`, `static-check`,
  `human`, `memory`, `web`, `web.search`, `orchestrate`, `message`, `media`.
- `CapabilityProvider` — a surface's bag of capability services (`repoRead`, `repoWrite`,
  `shell`, `staticCheck`, `human`, `web`, …) + the explicit `capabilities` set it advertises.
- `ToolDefinition` / `defineTool` (tool.ts) — OpenAI-schema + `requires: Capability[]` +
  `execute(args, ctx)`. Reaches the runtime ONLY through the injected `ToolContext`
  (`caps`, `signal`, `workspaceRoot`, `emit`). `ToolResult` carries `data` (model-visible JSON)
  and an optional `control` signal (`finish` / `ask_human`) so loop policy stays in the engine.
- `ToolRegistry` (registry.ts) — register + capability-filter + `schemasFor(provider)` +
  `dispatch(name,args,ctx)` (with call-time capability re-check). Replaces every per-surface
  array and the giant dispatch switch.
- `AgentEngine` / `AgentRunInput` / `AgentRunResult` (engine.ts) — the per-task run contract.
- `CORE_TOOLS` / `buildCoreToolRegistry()` (core-tools.ts) — the 12 runtime-agnostic tools:
  `list_files`, `search_code`, `read_file`, `write_file`, `edit_file`, `delete_file`,
  `run_checks`, `run_command`, `web_fetch`, `web_search`, `ask_human`, `finish`.

### 3.2 Engine seam — DI registry, not a branch
An engine is resolved by id and handed its collaborators at construction; callers depend on
the interface.

- **Cloud:** `runCloudToolLoop` drives `cloudToolRegistry` (= `buildCoreToolRegistry()`) through
  a per-surface `CapabilityProvider` (`buildCloudProvider`) — same loop on the Worker and the
  durable DO (one step per alarm tick), plus `handleContainerOp` for the container surface.
- **On-prem:** the **native embedded runner** (Claude-SDK `builderforce-v2` via `runV2Engine`),
  driving the full ~40-tool native `AgentTool` set out of the shared per-ticket workspace. (The
  earlier `LocalAgentEngine` shared-registry path was deleted as dead code — §5.5(a).)
- **The DI seam:** `builderforce-relay.ts` `resolveEngine(id)` is a one-entry `{ builderforce-v2 }`
  registry → an `AgentEngine`; any legacy id (`builderforce-v1`, `builderforce-local`) falls through
  to `DEFAULT_ENGINE_ID` (= v2). `dispatchTaskFromRelay` resolves + calls `.run()` — no V1/V2 branch.
  The seam is retained even with one runner so the NEXT engine is a registry entry, not a branch.

### 3.3 Capability-gated surfaces — same tools, different concretion (Dependency Inversion)
A tool's `execute` calls `ctx.caps.repoWrite.writeFile(...)`; each surface supplies a different
backing for that capability. No tool is cloud- or node-specific.

| Surface | Provider | repo I/O | shell | static-check | human | search | extras |
|---|---|---|---|---|---|---|---|
| Cloud Worker / Durable DO | `buildCloudProvider` | git-API commit/read | — | ✅ (config parse) | ✅ approvals | indexed | — |
| Cloud Container | (in-image) | local clone | ✅ real shell | — | — (gap) | shell grep | — |
| On-prem Node (`local`) | `buildNodeCapabilityProvider` | disk | ✅ real shell | — | ✅ approval-gate | disk/rg + web.search (config) | git/code intel, orchestrate, memory |

## 4. Current state — done & verified

**Cloud consolidation — ✅ effectively complete.**
- Both `CLOUD_AGENT_TOOLS` and `CONTAINER_AGENT_TOOLS` are now **derived** from
  `cloudToolRegistry.schemasForCapabilities(CAPS)` (cloudAgentTools.ts) — the hand-written
  arrays are gone; the Worker, DO, and Container all run the SAME shared definitions.
- `runCloudToolLoop` consumes the shared `CapabilityProvider`/`ToolRegistry`/`ToolContext`.
- **Model cascade:** a 429 on a strict-pinned cloud model drops the pin, walks the plan's
  chain, and locks the winner (cloudAgentEngine.ts) — plus `model.select` / `coding_model_degraded`
  telemetry so a run that floored onto a non-coder backstop is legible.

**Shared contract — ✅ built and consumed by both packages** (§3.1).

**On-prem pi-cutover — Stages 1, 2 (a+b), and 3 ✅ DONE (2026-06-13; see doc 10 for staged detail).**
- All ~40 on-prem tools have native pi-free `ToolDefinition`s. `buildNodeToolRegistry(deps?)`
  assembles core + `NODE_CODE_TOOLS` + `NODE_ORCHESTRATION_TOOLS` + config-gated
  `buildNodeServiceTools`. `NODE_SURFACE_CAPS` advertises `repo.* + shell + process + web +
  orchestrate + memory + message + media`.
- **The native agent loop is BUILT + WIRED into the embedded runner** (the keystone). The
  pi-FREE loop in [`src/builderforce/agent-loop/`](../../agent-runtime/src/builderforce/agent-loop/)
  — `SessionManager` (JSONL leaf-tree, byte-compatible with pi's v3 on-disk format + v1→v3
  migration), `Agent`/`agentLoop` (turn loop: stream→tool→feed-back→steer), `AgentSession`
  (`prompt`/`steer`/`abort`/`compact`/persistence), `SettingsManager`, `EventStream` +
  `createGatewayStreamFn`/`nativeStreamSimple`, compaction (`estimateTokens`/`generateSummary`),
  and the `ToolDefinition→AgentTool` adapter — **drives `attempt.ts`/`compact.ts`/`extra-params.ts`
  + the local-model stream factories**. ~15 native-loop unit tests green.
- **Native model layer:** `ModelRegistry`/`AuthStorage` ([pi-model-discovery.ts]) read `models.json`
  (gateway-routed, no pi catalog); `getModel`/`getEnvApiKey` shims; native file tools
  (read/write/edit, sandbox-op injection) + native `ToolDefinition`; native skills loader +
  extension types. Native LLM client (`nativeComplete`/`nativeStream`) over the gateway.
- **All `pi-ai` completion/vision/auth sites migrated:** TTS, model-scan, both vision tools →
  gateway `nativeComplete`; and the **entire OAuth/Codex subsystem ported natively**
  ([`src/agents/oauth/`](../../agent-runtime/src/agents/oauth/) — 5 providers' token-refresh
  flows + Codex PKCE device login).
- **pi footprint: `pi-agent-core` 0, `pi-coding-agent` 0, `pi-ai` 0** (all three deleted from
  `package.json`); **only `pi-tui` 18 remains**. `agent-runtime` + `api` `tsc --noEmit` = **0**.
  `live` verification (gateway runtime parity, OAuth token-refresh, terminal rendering) owed —
  structurally impossible in CI.

## 5. Remaining capabilities to implement

Grouped by theme. Each is a discrete, verifiable unit; "surface" notes where it lands.

### 5.1 On-prem pi removal tail (the bulk — detail in doc 10 §3–§5)
- ~~**Agent-loop swap (Stage 3).**~~ **✅ DONE 2026-06-13.** The native agent loop is built +
  wired into the embedded runner (`attempt.ts`/`compact.ts`/`extra-params.ts` + the local-model
  stream factories); `pi-agent-core` (incl. all `AgentTool`/`StreamFn`/message-type sites) and
  `pi-coding-agent` (embedded runner, compaction, skills, extensions, model-discovery,
  transcript) are at **0 imports** and removed from package.json. (NOTE: the loop was made native
  *in place* — the embedded runner that `runV1Engine`→`chat.send` drives — so on-prem chat/cron/
  channels already run pi-free; making `builderforce-local` the literal default is now an
  engine-*selection* question, see Stage 5, not a pi-removal blocker.)
- ~~**Completion/stream/auth migration (Stage 2b).**~~ **✅ DONE 2026-06-13.** All 27 `pi-ai`
  runtime sites migrated: TTS/image/media-understanding/model-scan → gateway `nativeComplete`;
  the local-model stream factories → native `createAssistantMessageEventStream`/`StreamFn`;
  native `getModel`/`getEnvApiKey` shims (gateway-routed) replaced `resolveModel` catalog lookups;
  and `agents/auth-profiles/*` + the Codex device flow ported natively to
  [`src/agents/oauth/`](../../agent-runtime/src/agents/oauth/). `pi-ai` = **0 imports**, removed
  from package.json. *Deltas (logged):* gateway-only model resolution (no pi bundled catalog),
  Vertex gcloud ADC not reproduced, OAuth port faithful but live-unverified, native loop has no
  extension runner yet (compaction-safeguard/context-pruning compile but are unwired).
- **TUI replacement (Stage 4) — ONLY REMAINING `pi-*` WORK.** Replace the **18 `pi-tui` sites**
  (the interactive CLI's render layer — `src/tui/`, `builderforce` TUI + onboarding wizard; NOT
  the agent runtime). `pi-tui` ships compiled JS only (no TS source), is an **~8,000-LOC component
  TUI framework** with native FFI (`koffi`) + `marked`/`chalk`/`get-east-asian-width`/`mime-types`
  deps. **Decision (operator, 2026-06-13): `ink` behind a render port — NOT a raw framework swap.**
  The load-bearing move is the **seam, not the framework**: a `TuiRenderer` interface resolved by id
  from a DI registry (the render-layer twin of `resolveEngine`), so `ink`-vs-native-`node:tty` becomes
  a swappable adapter, not a lock-in. We deliberately do **not** publish a general composable TUI
  framework for third parties — that is exactly the pi-tui maintenance-asymmetry trap; internal
  swappability needs only the port. **The seam is BUILT** (`packages/tui`, `@builderforce/tui`): the
  `TuiRenderer` contract + `RendererRegistry`/`DEFAULT_RENDERER_ID` (mirrors `ENGINE_IDS`) + a real
  working **headless** renderer (tests/CI, no TTY) + an **ink** adapter skeleton (the typed target;
  `start()` gated until the live render tree is wired). **Remaining:** migrate the 18 `pi-tui` sites
  onto the port and build the live `ink` render tree (add `ink`/`react`; swap `visibleWidth`/
  `truncateToWidth` → `string-width`/`cli-truncate`). **Needs a real terminal to verify rendering**
  (locked-decision-4). See `packages/tui/src/{renderer,registry}.ts` + `adapters/*`.
- ~~**Delete + flip default (Stage 5).**~~ **✅ V1 RETIRED 2026-06-13.** **Resolved decision:** the
  consolidated default is **`builderforce-v2`** (the Claude-Agent-SDK engine, gateway-routed) — NOT
  `builderforce-local`, because `local` is **on-prem-only** (the frontend/api `AGENT_ENGINES` set and
  `AgentEngine` type accept only `v1|v2`), so flipping the default to `local` would have broken cloud
  dispatch; `v2` is the only non-V1 engine valid on BOTH surfaces. Done: `DEFAULT_ENGINE_ID =
  ENGINE_IDS.v2` (single source — flips relay `resolveEngine` + cloud `resolveCloudAgent` +
  `workforceRoutes` create + `task.assign` fallback together); on-prem `runV1Engine` DELETED + its
  registry entry removed; `AGENT_ENGINES = ['builderforce-v2']`; frontend `AgentEngine` narrowed to
  `'builderforce-v2'`; migration `0120_engine_v2_retire_v1.sql` back-fills `ide_agents.engine` v1→v2
  + flips the column default. All 4 packages `tsc` 0; no test asserted the old default.
  (Update 2026-06-14, §5.5(a): `builderforce-local` was subsequently DELETED — it was never
  selectable, so it is no longer a registered engine.) **Remaining V1 tail (deploy-gated):** the
  cloud V1 **dispatch branch** is now unreachable dead code — the `isV2===false` else-path in
  `runtimeRoutes.ts` (~L430) + `cloudAgentTypeLabel`'s V1 arm — delete it after a cloud trace +
  deploy (un-migrated `engine='builderforce-v1'` rows still reach it until migration-0120 runs
  live, so source-removal is premature). The dormant on-prem `pendingTaskRun`/`flushPendingTaskChanges`
  cleanup is ✅ DONE (2026-06-14); migration-0120 apply + a live e2e still owed. `pi-tui` removal
  (drop the dep) still needs Stage 4.

### 5.2 Capability parity gaps (block "no reduced tool set" on a surface)
> **NOTE 2026-06-14:** the three `local`-engine items below (`ask_human` on Node, `web.search`
> adapter, local-engine streaming) were built against the now-DELETED `LocalAgentEngine` /
> `buildNodeCapabilityProvider` (§5.5(a)) and their wiring (`createNodeWebSearch`, the
> `NodeProviderOptions.human`/`webSearch` injections, `runLocalEngine`'s `LlmStream`) has been
> removed. On the LIVE on-prem path (the native embedded runner) these capabilities are served by
> the native `AgentTool`s instead — `askHumanTool`, `createWebSearchTool`, and the agent-loop's
> native streaming — so the surface still offers them; only the dead duplicate path is gone. Struck
> through for the record; no longer action items.
- ~~**`ask_human` on Node (on-prem `local`).**~~ **✅ DONE 2026-06-13; wiring removed with `local`
  2026-06-14 (served by native `askHumanTool`).** `buildNodeCapabilityProvider`
  now takes an optional `NodeProviderOptions.human` concretion and advertises `human` only when it
  is wired; the relay's `runLocalEngine` injects a `HumanCapability` backed by the approval-gate
  (`requestHumanInput` `kind: "question"` → portal queue, mirroring cloud `createCloudQuestion`).
  The in-process local loop blocks on the answer and feeds it back as the tool result (no
  durable pause needed on-prem). `web_search`/`ask_human` are gated out when no backing is given,
  so the surface never advertises a cap it cannot fulfill.
- **`ask_human` on the Cloud Container.** `CONTAINER_SURFACE_CAPS` omits `human` ("not yet
  wired in the image"). Wire the container-op `human` path so container runs can pause/resume
  like the durable surface. **Still open — needs the in-image loop + container build (infra),
  not just a Worker-side handler; not closable from the runtime/api source alone.**
- ~~**`web.search` backend.**~~ **✅ DONE 2026-06-13.** `web-search.ts` now exposes a pure
  `executeWebSearch` backend (brave/perplexity/grok, config-resolved) behind both the `web_search`
  tool and a new `createNodeWebSearch(config)` adapter that maps to the shared `WebSearchResult`.
  `runLocalEngine` injects it via `NodeProviderOptions.webSearch`, so on-prem advertises
  `web.search` and `web_search` is live (when a key is configured) instead of always-unavailable.
  Cloud surfaces still do not advertise `web.search` (no Worker backend) — tracked in the matrix.
- ~~**Streaming on the on-prem `local` engine.**~~ **✅ DONE 2026-06-13.** `LocalAgentEngine` now
  accepts an optional `LlmStream` (`createGatewayStream` over `nativeStream`); when present it
  streams each turn and fires `sinks.onAssistantDelta`. `runLocalEngine` injects it and forwards
  `chat.delta` frames (parity with V1's incremental output). Falls back to non-streaming
  `complete` when no stream client is supplied.

### 5.3 Cloud concretions of the Node-only tools (true cross-surface parity)
The orchestrate / memory / message / media / code-intelligence tools are currently Node-only
(no `CapabilityProvider` backing on the Worker/DO). For genuine "any tool on any surface":
- **`orchestrate` / `agent_fleet` / `workflow_status` cloud backing** — a cloud concretion of
  the orchestrate capability (workflow engine + fleet dispatch from the Worker), or an explicit
  decision that orchestration is on-prem-only and the cap is intentionally absent on cloud.
- **`memory` cloud backing** — cloud `memory_search`/`memory_get` against the
  builderforce-memory store, so cloud agents share the on-prem knowledge loop.
- **`media` (`ToolResult.content`) host delivery** — the content-block extension exists; wire
  host delivery (relay frame + portal render) so image/tts/canvas tool output is actually shown.

### 5.4 Cross-cutting hardening
- **`save_session_handoff` / knowledge loop Worker-side** — the cloud has no equivalent of the
  on-prem `.builderForceAgents` memory loop; decide whether cloud runs persist/recall handoffs.
- **Dispatch-internal + Queue + subagent/fleet on cloud** — the durable surface runs one step
  per tick but has no in-engine sub-agent/fleet dispatch; needed for orchestrate parity.
- **Container-companion OS-tools for the durable surface** — the DO has no shell; the design
  has it delegate OS-ops (`run_command`) to a container companion. Unbuilt.
- ~~**Single default-engine source of truth**~~ **✅ DONE 2026-06-13.** `@builderforce/agent-tools`
  exports `ENGINE_IDS` + `DEFAULT_ENGINE_ID` (engine.ts); the relay `resolveEngine` + `task.assign`
  fallback, cloud `resolveCloudAgent`, and `workforceRoutes` create-default all import it. **The flip
  is DONE: `DEFAULT_ENGINE_ID = ENGINE_IDS.v2` and V1 is retired (§5.5).**

### 5.5 V1-retirement residue & open questions (surfaced 2026-06-13 by the V1 cutover)
V1 is retired in source (default `builderforce-v2`, `runV1Engine` deleted, creation v2-only,
migration 0120 back-fill — §5.1 Stage 5). The remaining items are dead-code cleanup, deploy steps,
and one architecture question the cutover exposed:
- **Cloud V1 dispatch branch — now unreachable dead code (deploy-gated removal).** With creation
  restricted to v2 and all rows back-filled, the `isV2 === false` else-path in
  `api/.../runtimeRoutes.ts` (~L430) and `cloudAgentTypeLabel`'s V1 arm can never run. Delete them
  (and any cloud "V1 Cloud Agent" runtime wiring) after a cloud trace + a deploy to verify — not
  closable from source alone.
- ~~**Dormant on-prem dead code.** `pendingTaskRun` + `flushPendingTaskChanges`~~ **✅ DONE
  2026-06-14.** Both removed from `builderforce-relay.ts` (the field was write-never after
  `runV1Engine`'s deletion; the two callers in the gateway `legacy.state` handler were no-ops). The
  handler itself is KEPT — it still reports terminal execution state for the live native embedded
  runner (its other purpose). The `start()` workspace-sweep's `activeTaskIds` (which had read
  `pendingTaskRun`) is now `[]` — correct, since nothing is in flight at startup.
- **Migration 0120 apply + live e2e.** `0120_engine_v2_retire_v1.sql` must run on the live DB
  (back-fill `ide_agents.engine` v1→v2 + default flip); then an end-to-end check that a newly
  created agent dispatches on V2 across cloud (durable/container) and on-prem.
- ~~**OPEN QUESTION — is `builderforce-local` now unreachable, and is that intended?**~~ **RESOLVED
  2026-06-14 — operator decision (a): Claude-SDK-`builderforce-v2` is the canonical runner on BOTH
  surfaces; `builderforce-local` was DELETED as dead code.** It was never selectable (creation is
  v2-only; the frontend/api `AGENT_ENGINES` accept only `v2`), so no agent record carried it and no
  back-fill token is needed. Removed: the relay `local` registry entry + `runLocalEngine`;
  `shared-tools/local-agent-engine.ts` (`LocalAgentEngine` + `createGateway{Complete,Stream}`);
  `node-capability-provider.ts` (`buildNodeCapabilityProvider` + `NODE_SURFACE_CAPS`);
  `shared-tools/index.ts` (`buildNodeToolRegistry`); the 14 duplicate `build*ToolDef`
  `ToolDefinition` wrappers across `agents/tools/*` + the 3 `shared-tools/node-*-tools.ts` arrays;
  `ENGINE_IDS.local`; and the orphaned `createNodeWebSearch`. **Kept:** every `run*` pure backend
  (`runCodebaseSearch`, `runOrchestrate`, `runGateway`, `runMemorySearch`, …) and every native
  `create*Tool` `AgentTool` — the live on-prem path. Net effect: this collapsed an engine-introduced
  DRY violation (each service tool had been defined twice — once as `AgentTool`, once as
  `ToolDefinition`). The §5.1/§5.2/§5.3 `local` wins (full `NodeServiceToolDeps`, `ask_human` on
  Node, `web.search` adapter, local-engine streaming) were consciously discarded as the cost of (a).
  All 4 packages `tsc` 0.
- ~~**`LocalAgentEngine` compaction / session-persistence parity (only if `local` is kept).**~~
  **N/A — `local` deleted (a).** The live on-prem path is the native embedded runner, which already
  has `SessionManager` + compaction.

## 6. Surfaces × capabilities — target matrix (post-consolidation)

The on-prem column is now the **native embedded runner** (Claude-SDK `builderforce-v2`, full
~40-tool native `AgentTool` set) — the deleted `builderforce-local` shared-registry engine (§5.5(a))
is gone, so on-prem capabilities are served by the native `create*Tool`s, not the (deleted)
`CapabilityProvider`.

| Capability | Worker/DO | Container | On-prem (native v2) |
|---|---|---|---|
| repo.read/search/write/edit/delete | ✅ | ✅ (shell grep, no indexed search) | ✅ |
| shell / process | — | ✅ | ✅ |
| static-check | ✅ | — | — (real shell instead) |
| human (ask_human) | ✅ | **gap → 5.2** | ✅ (native `askHumanTool`) |
| web / web.search | web ✅ / search **gap → 5.3** | via shell | web ✅ / search ✅ (native `web_search`) |
| memory | **gap → 5.3** | **gap → 5.3** | ✅ |
| orchestrate | **gap → 5.3** | **gap → 5.3** | ✅ |
| message / media | **gap → 5.3** | **gap → 5.3** | ✅ |

## 7. Acceptance / verification

- **Contract:** adding a `defineTool(...)` + `register()` makes the tool appear on every surface
  that backs its capability with no per-surface array edit (already true; keep as a guard).
- **Cloud:** `CLOUD_AGENT_TOOLS`/`CONTAINER_AGENT_TOOLS` remain derived (no hand-written arrays);
  a cloud run executes the shared loop with model-cascade telemetry. ✅ today.
- **On-prem parity:** an on-prem chat/cron/channel session runs end-to-end on the **native embedded
  runner** (Claude-SDK `builderforce-v2`) with the full ~40-tool native `AgentTool` set, streaming,
  and `ask_human` pause/resume; `grep @mariozechner agent-runtime/src` → only `pi-tui` (Stage 4).
  (The `builderforce-local` shared-registry engine that previously held this gate was deleted —
  §5.5(a).)
- **Render seam:** the interactive CLI draws through a `TuiRenderer` resolved from `RendererRegistry`
  (no `@mariozechner/pi-tui` import at any `src/tui/*` site); swapping `ink`→native is a new adapter
  + registry entry, no call-site edit. The headless renderer drives `src/tui` tests without a TTY.
- **Default flip:** ✅ DONE — default is `builderforce-v2` on every surface; no `builderforce-v1`
  runner is reachable (`runV1Engine` deleted; v1 not creatable). `tsc` 0 across `shared` + `api` +
  `agent-runtime` + `frontend`; live `pnpm build && check && test` + the cloud V1-branch deletion owed.
- **Every stage lands green:** all three packages at `tsc` 0 + suites passing before the next.

## 8. Sequencing & risk

- **Fixed order (on-prem):** 2a ✅ → (2b+3 combined) ✅ → 4 (pi-tui, ONLY remaining) → 5
  (drop pi-tui dep + the single default-engine decision). Nothing deleted before its replacement
  is wired + verified. **Stages 2a/2b/3 are complete** — the embedded runner is native and the
  on-prem agent runtime is pi-free; the engine seam means the literal default is now a
  consolidation choice (§5.1 Stage 5), not a pi blocker.
- **Highest risk now:** Stage 4 (the pi-tui TUI-framework replacement, terminal-verified) and the
  §5.3 cloud concretions. Stage 2b/3's risk (every LLM call + every surface) is retired — green.
- **Stage 5 superseded by §5.5(a) (2026-06-14):** the default was NOT flipped to `builderforce-local`
  — `local` was deleted instead. The §5.2 `local` wins (`ask_human`-on-Node, `web.search` adapter,
  local-engine streaming) were removed with it; the live on-prem path is the native embedded runner,
  which already provides them via native `AgentTool`s. Remaining real work: §5.1 Stage 4 (pi-tui),
  §5.3 cloud concretions, and the §5.2 `ask_human` on the Cloud Container (infra-blocked — needs the
  container image's in-loop handler).

## 9. References
- [10-prd-pi-cutover.md](10-prd-pi-cutover.md) — staged on-prem `pi-*` removal (Stages 2b–5 detail).
- `packages/agent-tools/src/{capabilities,tool,registry,engine,core-tools}.ts` — the tool/engine contract.
- `packages/tui/src/{renderer,registry}.ts` + `adapters/{headless,ink}-renderer.ts` — the render seam (`@builderforce/tui`).
- `agent-runtime/src/infra/builderforce-relay.ts` `resolveEngine` — the engine DI seam (now a
  one-entry `{ v2 }` registry; the `RendererRegistry` mirrors it).
- `agent-runtime/src/builderforce/shared-tools/{node-code-tools,node-orchestration-tools,node-service-tools}.ts`
  — the `run*` pure backends shared by the native `create*Tool` `AgentTool`s. (The `LocalAgentEngine` /
  `node-capability-provider` / `buildNodeToolRegistry` / `build*ToolDef` layer was deleted — §5.5(a).)
- `api/src/application/runtime/{cloudAgentEngine,cloudAgentTools}.ts` — the cloud engine/registry.
- Root `README.md` → Consolidated Gap Register → "Remove `@mariozechner/pi-*`" bullet.

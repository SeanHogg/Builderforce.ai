# 11 — PRD: Agent Engine Consolidation (one contract, one engine seam, four surfaces)

**Status: In progress.** Umbrella PRD for the program that collapses Builderforce's
formerly-forked agent runtimes into **one tool contract + one swappable engine seam**,
runnable on every surface. The on-prem `@mariozechner/pi-*` removal — the largest single
slice — has its own staged plan in [10-prd-pi-cutover.md](10-prd-pi-cutover.md); this
doc is the feature-level source of truth: what the consolidation *is*, what is *done*,
and every **remaining capability** still to implement across all surfaces.

**Operator decisions carried in (2026-06-13):** retire V1 entirely; one surface-agnostic
engine with **full tool parity on every surface — no reduced tool set anywhere**; new
runners join via **interfaces + dependency injection** (a registry entry, never a new
dispatch branch); per-surface differences are **injected dependencies**, not forked engines.

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
- **On-prem:** `LocalAgentEngine` (shared-tools/local-agent-engine.ts) — a pi-free
  model→tools→dispatch loop over `buildNodeToolRegistry()` and `buildNodeCapabilityProvider()`,
  with the model client INJECTED (`createGatewayComplete` → gateway `/v1/chat/completions`).
- **The DI seam:** `builderforce-relay.ts` `resolveEngine(id)` maps `builderforce-v1` (legacy pi
  loop via `chat.send`), `builderforce-v2` (Claude Agent SDK), and `builderforce-local`
  (LocalAgentEngine) → an `AgentEngine`. `dispatchTaskFromRelay` resolves + calls `.run()` —
  no V1/V2 branch. Adding a runner = one registry entry; removing V1 = delete its entry +
  `runV1Engine`. Default is still `builderforce-v1` until parity is proven (one-line flip).

### 3.3 Capability-gated surfaces — same tools, different concretion (Dependency Inversion)
A tool's `execute` calls `ctx.caps.repoWrite.writeFile(...)`; each surface supplies a different
backing for that capability. No tool is cloud- or node-specific.

| Surface | Provider | repo I/O | shell | static-check | human | search | extras |
|---|---|---|---|---|---|---|---|
| Cloud Worker / Durable DO | `buildCloudProvider` | git-API commit/read | — | ✅ (config parse) | ✅ approvals | indexed | — |
| Cloud Container | (in-image) | local clone | ✅ real shell | — | — (gap) | shell grep | — |
| On-prem Node (`local`) | `buildNodeCapabilityProvider` | disk | ✅ real shell | — | — (gap) | disk/rg | git/code intel, orchestrate, memory |

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

**On-prem pi-cutover — Stage 1 + Stage 2 foundations ✅ (see doc 10 for the staged detail).**
- All ~40 on-prem tools have native pi-free `ToolDefinition`s. `buildNodeToolRegistry(deps?)`
  assembles core + `NODE_CODE_TOOLS` (git_history, code_analysis, project_knowledge,
  codebase_search, codebase_semantic_search) + `NODE_ORCHESTRATION_TOOLS` (orchestrate,
  agent_fleet, workflow_status, save_session_handoff) + config-gated `buildNodeServiceTools`
  (agents_list, gateway, sessions_*, session_status, subagents, nodes, cron, tts, canvas,
  image, message, memory_search, memory_get, browser).
- `NODE_SURFACE_CAPS` advertises `repo.* + shell + process + web + orchestrate + memory +
  message + media`.
- `LocalAgentEngine` is pi-free and proven (local-agent-engine.test.ts: write→finish on disk,
  ask_human pause, no-tool-call stop). Registered as `builderforce-local` in `resolveEngine`.
- Native LLM client (`model/native-llm.ts` — `nativeComplete` + SSE `nativeStream`) and native
  model types (`model/types.ts`, faithful pi-ai shapes) exist; all type-only `pi-ai` imports
  repointed (Stage 2a).
- Measured pi footprint reduction: `pi-agent-core` 114→11, `pi-ai` 94→27,
  `pi-coding-agent` 49→41, `pi-tui` 20→18 source files.
- Both `api` and `agent-runtime` `tsc --noEmit` are at **0 errors**.

## 5. Remaining capabilities to implement

Grouped by theme. Each is a discrete, verifiable unit; "surface" notes where it lands.

### 5.1 On-prem pi removal tail (the bulk — detail in doc 10 §3–§5)
- **Agent-loop swap (Stage 3).** Make `LocalAgentEngine` the runner for **all** on-prem surfaces
  (chat, cron, channels — not just ticket dispatch), threading the `NodeServiceToolDeps` bag so
  service/media tools resolve. Migrate the 11 `pi-agent-core` type sites + the 41
  `pi-coding-agent` sites (the embedded runner, compaction, context-pruning, skills, transcript,
  `chat.ts`) to native. **Blocks the default flip.**
- **Completion/stream/auth migration (Stage 2b).** Move the remaining 27 `pi-ai` runtime sites
  (TTS, image, media-understanding, model-scan, the local-model stream factories) onto
  `nativeComplete`/`nativeStream`; build the **non-relay gateway-routing shim** (a config-resolved
  gateway base+key for code that isn't the relay) + a native `getModel`/auth resolver to replace
  `resolveModel`+`getApiKeyForModel`. **Coupled with Stage 3** (the stream factories return pi's
  `StreamFn`). Touches `agents/auth-profiles/*` (OAuth/Codex device flows have no native shim yet).
- **TUI replacement (Stage 4).** Replace the 18 `pi-tui` sites (CLI rendering) with a native
  renderer; preserve CLI UX.
- **Delete + flip default (Stage 5).** `grep @mariozechner` → empty; flip on-prem default
  `builderforce-v1` → `builderforce-local` in `resolveEngine` + the `task.assign/broadcast`
  fallback; backfill persisted `engine`; drop the 4 deps from package.json + lockfile.

### 5.2 Capability parity gaps (block "no reduced tool set" on a surface)
- **`ask_human` on Node (on-prem `local`).** `NODE_SURFACE_CAPS` omits `human`, so the local
  engine cannot pause for a human. Add a `HumanCapability` concretion to the Node provider
  (route to the relay approval-gate / portal queue, mirroring cloud `createCloudQuestion`) and
  add `human` to the cap set. Until then, on-prem `local` runs silently cannot block on input.
- **`ask_human` on the Cloud Container.** `CONTAINER_SURFACE_CAPS` omits `human` ("not yet
  wired in the image"). Wire the container-op `human` path so container runs can pause/resume
  like the durable surface.
- **`web.search` backend.** No surface advertises `web.search` (Node implements `search()`
  defensively returning "no backend"). Wire a search backend (e.g. via the gateway) and add the
  cap where backed, so `web_search` becomes live instead of always-unavailable.
- **Streaming on the on-prem `local` engine.** `runLocalEngine` uses non-streaming
  `createGatewayComplete`; chat/channel UX needs incremental output. Switch the local engine to
  `nativeStream` with text + tool-content sinks (the relay already has frame sinks).

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
- **Single default-engine source of truth** — the default `builderforce-v1` is encoded in BOTH
  `resolveEngine` and the `task.assign/broadcast` handler fallback, and again cloud-side in
  `resolveCloudAgent`. The flip must change all of them together; extract one shared default
  (DRY) so the flip is one edit.

## 6. Surfaces × capabilities — target matrix (post-consolidation)

| Capability | Worker/DO | Container | On-prem `local` |
|---|---|---|---|
| repo.read/search/write/edit/delete | ✅ | ✅ (shell grep, no indexed search) | ✅ |
| shell / process | — | ✅ | ✅ |
| static-check | ✅ | — | — (real shell instead) |
| human (ask_human) | ✅ | **gap → 5.2** | **gap → 5.2** |
| web / web.search | web ✅ / search **gap → 5.2** | via shell | web ✅ / search **gap → 5.2** |
| memory | **gap → 5.3** | **gap → 5.3** | ✅ |
| orchestrate | **gap → 5.3** | **gap → 5.3** | ✅ |
| message / media | **gap → 5.3** | **gap → 5.3** | ✅ |

## 7. Acceptance / verification

- **Contract:** adding a `defineTool(...)` + `register()` makes the tool appear on every surface
  that backs its capability with no per-surface array edit (already true; keep as a guard).
- **Cloud:** `CLOUD_AGENT_TOOLS`/`CONTAINER_AGENT_TOOLS` remain derived (no hand-written arrays);
  a cloud run executes the shared loop with model-cascade telemetry. ✅ today.
- **On-prem parity:** an on-prem chat/cron/channel session runs end-to-end on `LocalAgentEngine`
  with the full ~40-tool set, streaming, and `ask_human` pause/resume; `grep @mariozechner
  agent-runtime/src` → empty (Stage 5 gate).
- **Default flip:** on-prem default is `builderforce-local`; no `builderforce-v1` path is reachable;
  `pnpm build && pnpm check && pnpm test` green across `shared` + `api` + `agent-runtime`.
- **Every stage lands green:** all three packages at `tsc` 0 + suites passing before the next.

## 8. Sequencing & risk

- **Fixed order (on-prem):** 2a ✅ → (2b+3 combined) → 4 → 5. Nothing deleted before its
  replacement is wired + verified. The engine registry seam lets `builderforce-local` be
  exercised in parallel with the still-default pi loop before the flip.
- **Highest risk:** Stage 2b/3 (every LLM call + every surface) and the §5.3 cloud concretions.
- **Independent, lower-risk wins available now:** §5.2 `ask_human`-on-Node, `web.search` backend,
  local-engine streaming — each shippable without touching the pi loop.

## 9. References
- [10-prd-pi-cutover.md](10-prd-pi-cutover.md) — staged on-prem `pi-*` removal (Stages 2b–5 detail).
- `packages/agent-tools/src/{capabilities,tool,registry,engine,core-tools}.ts` — the contract.
- `agent-runtime/src/infra/builderforce-relay.ts` `resolveEngine` — the DI seam.
- `agent-runtime/src/builderforce/shared-tools/*` — Node provider, engine, native tools.
- `api/src/application/runtime/{cloudAgentEngine,cloudAgentTools}.ts` — the cloud engine/registry.
- Root `README.md` → Consolidated Gap Register → "Remove `@mariozechner/pi-*`" bullet.

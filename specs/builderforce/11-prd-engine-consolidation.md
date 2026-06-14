# 11 — PRD: Agent Engine Consolidation (one contract, one engine seam, four surfaces)

**Status: On-prem pi-removal ~95% (3 of 4 deps deleted; runtime pi-free; only `pi-tui` + the
single default-engine flip remain).** Umbrella PRD for the program that collapses Builderforce's
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
serving the full ~40-tool set** — the default must NOT regress to a reduced set. (Note the
engine the on-prem default lands on must carry the full `buildNodeToolRegistry` tool set;
`builderforce-local`'s registry must be built WITH its `NodeServiceToolDeps` bag so the
~12 service/media tools are present, not just the ~21 core+code+orchestration tools — see
§5.1.)

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
- **Delete + flip default (Stage 5).** `grep @mariozechner agent-runtime/src` → empty (only
  pi-tui left); drop `pi-tui` from package.json + lockfile (`pnpm install`). **Default-engine
  decision (operator):** per the §intro clarification (retire V1, full 40-tool parity, no reduced
  set), the on-prem default should resolve to the native engine carrying the FULL tool set. Two
  shapes: **(a)** flip `resolveEngine` default `builderforce-v1` → `builderforce-local` AND ensure
  `runLocalEngine` builds `buildNodeToolRegistry` **with `NodeServiceToolDeps`** (so local has all
  ~40 tools + streaming via `nativeStream`, per §5.2) before the flip, OR **(b)** keep
  `runV1Engine` (now pi-free, dispatches to the native embedded runner with the full set) as the
  default and delete `runV2`/`local` divergence — i.e. V1's *implementation* is already the native
  full-tool runtime. Either way, extract the default to ONE source of truth (it's duplicated in
  `resolveEngine` + the `task.assign/broadcast` fallback + cloud `resolveCloudAgent`, §5.4) so the
  flip is one edit. **Today both `runV1Engine` and the on-prem chat/cron path are pi-free**; this
  step is the explicit engine consolidation + the single literal default, not a pi blocker.

### 5.2 Capability parity gaps (block "no reduced tool set" on a surface)
- ~~**`ask_human` on Node (on-prem `local`).**~~ **✅ DONE 2026-06-13.** `buildNodeCapabilityProvider`
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
  now exports `ENGINE_IDS` + `DEFAULT_ENGINE_ID` (engine.ts). Every previously-duplicated literal
  imports it: the relay `resolveEngine` + `task.assign/broadcast` fallback, cloud `resolveCloudAgent`
  (DEFAULT + row fallback), and `workforceRoutes` agent-create default. Flipping the default to
  `ENGINE_IDS.local` is now a ONE-line change in engine.ts (still `builderforce-v1` until on-prem
  tool parity is proven — §5.1 Stage 5).

## 6. Surfaces × capabilities — target matrix (post-consolidation)

| Capability | Worker/DO | Container | On-prem `local` |
|---|---|---|---|
| repo.read/search/write/edit/delete | ✅ | ✅ (shell grep, no indexed search) | ✅ |
| shell / process | — | ✅ | ✅ |
| static-check | ✅ | — | — (real shell instead) |
| human (ask_human) | ✅ | **gap → 5.2** | ✅ (5.2 done) |
| web / web.search | web ✅ / search **gap → 5.3** | via shell | web ✅ / search ✅ (5.2 done) |
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
- **Render seam:** the interactive CLI draws through a `TuiRenderer` resolved from `RendererRegistry`
  (no `@mariozechner/pi-tui` import at any `src/tui/*` site); swapping `ink`→native is a new adapter
  + registry entry, no call-site edit. The headless renderer drives `src/tui` tests without a TTY.
- **Default flip:** on-prem default is `builderforce-local`; no `builderforce-v1` path is reachable;
  `pnpm build && pnpm check && pnpm test` green across `shared` + `api` + `agent-runtime`.
- **Every stage lands green:** all three packages at `tsc` 0 + suites passing before the next.

## 8. Sequencing & risk

- **Fixed order (on-prem):** 2a ✅ → (2b+3 combined) ✅ → 4 (pi-tui, ONLY remaining) → 5
  (drop pi-tui dep + the single default-engine decision). Nothing deleted before its replacement
  is wired + verified. **Stages 2a/2b/3 are complete** — the embedded runner is native and the
  on-prem agent runtime is pi-free; the engine seam means the literal default is now a
  consolidation choice (§5.1 Stage 5), not a pi blocker.
- **Highest risk now:** Stage 4 (the pi-tui TUI-framework replacement, terminal-verified) and the
  §5.3 cloud concretions. Stage 2b/3's risk (every LLM call + every surface) is retired — green.
- ~~**Independent, lower-risk wins available now:** §5.2 `ask_human`-on-Node, `web.search` backend,
  local-engine streaming~~ **✅ ALL THREE DONE 2026-06-13** (each shippable without touching the
  now-native loop). Plus §5.4 single default-engine source of truth. These were the prerequisites
  for Stage 5 flipping the default to `builderforce-local`; the remaining Stage-5 blockers are the
  full-tool-set wiring (`buildNodeToolRegistry` WITH `NodeServiceToolDeps` in `runLocalEngine`,
  §5.1) and the pi-tui removal (§5.1 Stage 4). Remaining §5.2 item: `ask_human` on the Cloud
  Container (infra-blocked — needs the container image's in-loop handler).

## 9. References
- [10-prd-pi-cutover.md](10-prd-pi-cutover.md) — staged on-prem `pi-*` removal (Stages 2b–5 detail).
- `packages/agent-tools/src/{capabilities,tool,registry,engine,core-tools}.ts` — the tool/engine contract.
- `packages/tui/src/{renderer,registry}.ts` + `adapters/{headless,ink}-renderer.ts` — the render seam (`@builderforce/tui`).
- `agent-runtime/src/infra/builderforce-relay.ts` `resolveEngine` — the engine DI seam (the `RendererRegistry` mirrors it).
- `agent-runtime/src/builderforce/shared-tools/*` — Node provider, engine, native tools.
- `api/src/application/runtime/{cloudAgentEngine,cloudAgentTools}.ts` — the cloud engine/registry.
- Root `README.md` → Consolidated Gap Register → "Remove `@mariozechner/pi-*`" bullet.

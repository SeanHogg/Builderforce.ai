# 12 — PRD: Unified Agent Engine (one loop, one tool contract, V3-ready)

**Status: PHASES A + D DONE & VERIFIED; PHASE B/C BLOCKED on a live-verification environment (2026-06-14).**
On-prem now drives the **shared `AgentEngine` contract** (same interface the cloud `CloudToolLoopEngine`
implements) and both surfaces resolve engines through one shared `resolveEngineById` helper — so a V3 is
a sibling `AgentEngine` registered the same way on either surface. The user's primary ask ("easily swap
in a V3; the agent is the same on Cloud and On-Prem") is met at the ENGINE layer. The TOOL-layer goal
("tools run on prem AND cloud, 100% reuse") was rescoped after a critical finding (§3.5): the on-prem
native tools are a *hardened superset* of the thin shared core-tools, so the original Phase B — "delete
the native defs, use the shared registry" — would REGRESS on-prem. Phase B/C are redesigned below.

> **Disposition under the `[Finish completely - no deferral]` rule (global hook, 2026-06-14).** Nothing
> here is left partial, half-wired, or broken: Phases A + D are complete, type-clean, and unit-tested;
> NO dead/speculative code was added (the `buildNodeCapabilityProvider` is intentionally NOT built yet —
> it would be dead until the live swap). Phase B/C are **not a convenience deferral** — they are gated on
> a concrete, rule-recognized blocker: a **live verification environment** (a real gateway + a real repo +
> running the on-prem agent) is required to confirm the model still drives the converged tools correctly
> once their NAMES/PARAM-SCHEMAS/RETURN-SHAPES change on the load-bearing session loop, and that
> sandbox/image-read/per-provider-schema hardening still holds. Static `tsc` + unit tests cannot prove
> model-facing tool behavior. **What clears it:** an owner-run session against a live gateway+repo where
> the converged tools can be exercised end-to-end (see §9 "Blocker" for the exact gate). Until then the
> codebase stays in its current WORKING state — no partial wiring shipped.

---

### Original framing (retained) — ANALYSIS / VALIDATION (2026-06-14) A review of the Agent Engine seam against three
operator goals — *(1) the engine is DRY, solid, and easily swapped (so a V3 drops in next to the
Claude-SDK V2); (2) the agent is the SAME on Cloud and On-Prem; (3) tools run on both surfaces with
100% code reuse.* **Verdict: the seam is solid and swap-ready on each surface individually, but the
"same agent / 100% reuse" goal is NOT met today.** The shared `@builderforce/agent-tools` contract is
consumed by **cloud only**; on-prem runs two *separate* loops that bypass it, and the bridge built to
connect them is **dead code (no live caller)**. This PRD records the verified state and specifies the
convergence that makes a single V3 engine + tool set serve every surface.

> Companion to [11-prd-engine-consolidation.md](11-prd-engine-consolidation.md). Doc 11 declared the
> target ("one tool contract + one swappable engine seam, runnable on every surface") and is correct
> about the *cloud* outcome. This doc validates doc 11 §6's claims against the **live on-prem code**
> and finds drift: the on-prem column is served by neither the shared registry nor a uniform loop.

---

## 1. What was reviewed

| Layer | File |
|---|---|
| Relay engine seam (orchestration) | [agent-runtime/src/infra/agent-engine.ts](../../agent-runtime/src/infra/agent-engine.ts) — `RelayTaskEngine` |
| Relay DI registry + dispatch | [agent-runtime/src/infra/builderforce-relay.ts](../../agent-runtime/src/infra/builderforce-relay.ts) — `resolveEngine`, `runV2Engine` |
| On-prem task runner (LIVE) | [agent-runtime/src/agents/claude-agent-sdk-runner.ts](../../agent-runtime/src/agents/claude-agent-sdk-runner.ts) — `runClaudeAgentSdkV2` |
| On-prem session runner (LIVE) | [agent-runtime/src/agents/embedded-runner/run/attempt.ts](../../agent-runtime/src/agents/embedded-runner/run/attempt.ts) — native agent-loop |
| Shared loop contract | [packages/agent-tools/src/engine.ts](../../packages/agent-tools/src/engine.ts) — `AgentEngine`, `ENGINE_IDS` |
| Shared tool contract | [packages/agent-tools/src/{tool,registry,capabilities,core-tools}.ts](../../packages/agent-tools/src/) |
| Cloud engine + tools | [api/src/application/runtime/cloudAgentEngine.ts](../../api/src/application/runtime/cloudAgentEngine.ts), [cloudAgentTools.ts](../../api/src/application/runtime/cloudAgentTools.ts) |
| The (dead) bridge | [agent-runtime/src/builderforce/agent-loop/tool-adapter.ts](../../agent-runtime/src/builderforce/agent-loop/tool-adapter.ts) — `registryToAgentTools` |

## 2. Verified state — three loops, two interfaces, one unused bridge

There is **not one agent**. There are three execution loops, and the two interfaces named "engine" are
distinct layers:

- **`AgentEngine`** (shared, `packages/agent-tools/engine.ts`): pure per-task loop — `run(input) →
  AgentRunResult`. Caller owns terminal reporting.
- **`RelayTaskEngine`** (on-prem, `infra/agent-engine.ts`): orchestration layer — `run(dispatch,
  prompt) → void`. Owns workspace clone, change attribution, commit/push/PR, execution-state reporting.

### 2.1 The three loops

| # | Surface / trigger | Loop | Tools it runs | Consumes shared `@builderforce/agent-tools`? |
|---|---|---|---|---|
| 1 | **Cloud** Worker/DO/Container | `CloudToolLoopEngine implements AgentEngine` → `runCloudToolLoop` | shared `cloudToolRegistry` via `CapabilityProvider` (git-over-HTTP) | ✅ **Yes** — registry + caps + `ToolContext` |
| 2 | **On-prem TASK** (`task.assign`/`task.broadcast`) | `RelayTaskEngine` (`resolveEngine` → `runV2Engine`) → `runClaudeAgentSdkV2` | **Claude Agent SDK's own built-ins**: `Read, Write, Edit, Bash, Glob, Grep` (6) | ❌ **No** — SDK-internal tools; never touches the registry |
| 3 | **On-prem SESSION** (chat/cron/channels via `chat.send`) | embedded runner (`attempt.ts`) → native `agentLoop`/`AgentSession` | native `AgentTool` set (~40, `createBuilderForceAgentsCodingTools` …) backed by shared `run*` pure backends | ❌ **No** — its own `AgentTool` definitions (`toClientToolDefinitions`), not the shared `ToolDefinition` registry |

### 2.2 The dead bridge

[`tool-adapter.ts`](../../agent-runtime/src/builderforce/agent-loop/tool-adapter.ts) exports
`toAgentTool` / `registryToAgentTools` — exactly the adapter that would let loop #3 run the shared
`ToolDefinition` registry through a Node `CapabilityProvider`. It is **unwired**: the only references are
its own `tool-adapter.test.ts` and a re-export in `agent-loop/index.ts`. No production path calls it.
(It also calls `registry.toolsFor(provider)`, while cloud uses `schemasForCapabilities(caps)` — the API
surface has drifted to two near-duplicate spellings; see registry.ts L43–L66.)

### 2.3 What IS shared today

- The capability vocabulary + result shapes (`capabilities.ts`) are imported by both packages.
- The `run*` pure backends (`runCodebaseSearch`, `runOrchestrate`, `runGateway`, `runMemorySearch`, …)
  back **both** the cloud tools and the on-prem native `AgentTool`s — so the *logic* of a tool is often
  shared even though the *tool object the model sees* is defined twice (once as cloud `ToolDefinition`,
  once as native `AgentTool`).
- Telemetry frames are normalized so the portal renders all three loops identically.

### 3.5 CRITICAL FINDING (2026-06-14) — native session tools are a HARDENED SUPERSET, not duplicates

Surfaced while executing Phase B. The on-prem session tool set
([`agents/coding-tools.ts`](../../agent-runtime/src/agents/coding-tools.ts)
`createBuilderForceAgentsCodingTools`) is **not** a duplicate of the 12 shared `core-tools` — it is a
higher-altitude superset that carries, per tool, machinery the thin cloud-oriented core-tools do not:

- **Sandbox variants** (`createSandboxedRead/Write/Edit`, fs-bridge) + workspace-root guards / `workspaceOnly`.
- **Per-provider schema normalization** (OpenAI rejects root unions; Gemini needs constraint stripping; Anthropic keeps them) and Claude-Code param-group compatibility (`wrapToolParamNormalization`).
- **Model-context-window-scaled read budgets** + **image sanitization** on the read tool.
- **`apply_patch`** (OpenAI/codex), **background process management** (`process` tool) — no core-tools equivalent.
- **Owner-only / subagent-depth / group tool-policy pipelines**, **before-tool-call hooks** (loop detection), **abort-signal wrapping**.

The shared `core-tools` were deliberately built thin for the **serverless cloud surface** (git-over-HTTP,
no shell, no sandbox). **Conclusion:** the original Phase B ("rip out native tools, use the shared
registry") would strip this hardening — a real regression on every on-prem chat/cron/channel session.
The correct convergence shares the **contract** (names, schemas, capability gating, result shapes) and
routes it through a `CapabilityProvider` whose concretions wrap the **existing hardened native
backends** — not the thin cloud concretions. This is a careful multi-pass effort, redesigned in §5.
(The shared `run*` pure backends are already shared; the divergence is at the tool-OBJECT layer.)

## 3. Validation against the three goals

| Operator goal | Verdict | Evidence |
|---|---|---|
| **Engine is DRY, solid, easily swapped (V3 next to V2)** | 🟡 **Partly.** Each surface has a clean DI seam (`resolveEngine` on-prem, `resolveCloudAgent` on cloud) — adding a runner is a registry entry, not a branch. **But there are TWO seams, not one,** and a V3 added to one does not appear on the other. | `resolveEngine` is a one-entry `{ v2 }` registry; doc 11 §5.4 confirms the cloud seam is separate. |
| **Same agent on Cloud and On-Prem** | 🟢 **At the engine layer — DONE this pass.** On-prem task now drives the shared `AgentEngine` (`ClaudeSdkAgentEngine implements AgentEngine`), the same contract cloud implements; the relay `RelayTaskEngine` orchestrates around it. (Loops still differ in body — cloud step-loop vs SDK vs native session — but they share ONE swappable interface, which is what "swap in a V3" requires.) | §9 execution log; `infra/sdk-agent-engine.ts`. |
| **Tools run on prem AND cloud, 100% reuse** | 🔴 **No — and rescoped (§3.5).** The contract is runtime-agnostic + capability-gated but consumed by cloud only; on-prem session runs the hardened native superset (NOT duplicates). Convergence must wrap native backends behind the provider seam, not delete them. | §2.1, §2.2, §3.5. |

**Bottom line:** doc 11 *built* the right contract and *finished* the cloud half. The on-prem half was
left on two pre-existing loops (SDK + native), the shared registry was never wired in on-prem, and doc
11 §6's "on-prem = native runner serving the full ~40-tool set" describes loop #3 — but the **task**
path (loop #2, the one that actually runs kanban/orchestrated dispatch) runs the SDK with **6** tools,
not 40, and shares nothing with cloud. That is the real gap behind "make it the same everywhere."

## 4. Target architecture — one `AgentEngine`, one registry, per-surface providers

The end state that satisfies all three goals:

```
                        ┌────────────────────────────┐
   one DI registry  →   │  AgentEngine (shared)       │   id-resolved, V2 today / V3 tomorrow
   (both surfaces)      │  run(input) → AgentRunResult│
                        └─────────────┬──────────────┘
                                      │ drives
                        ┌─────────────▼──────────────┐
                        │  ToolRegistry (shared)      │   buildCoreToolRegistry() + native tools
                        │  dispatch(name,args,ctx)    │   one ToolDefinition per tool
                        └─────────────┬──────────────┘
                                      │ via ToolContext.caps
            ┌─────────────────────────┼─────────────────────────┐
   buildCloudProvider          buildNodeCapabilityProvider   (container provider)
   git-over-HTTP, no shell      disk + real shell + memory    local clone + shell
```

Three moves:

1. **One engine interface across surfaces.** Make the on-prem runner an `AgentEngine` implementation
   (an SDK-backed `AgentEngine`, not a parallel `RelayTaskEngine` that hides the SDK). `RelayTaskEngine`
   stays as the thin orchestration wrapper (workspace/commit/report) that *drives* an `AgentEngine` —
   the same `AgentEngine` cloud drives. A V3 is then **one** `AgentEngine` registered on **one** registry
   that both surfaces resolve from.
2. **On-prem consumes the shared `ToolRegistry`.** Wire the already-built `tool-adapter.ts`
   (`registryToAgentTools`) + a Node `CapabilityProvider`, so the native loop offers the *same*
   `ToolDefinition`s cloud offers (capability-gated: on-prem advertises `shell`/`process`/`memory`/
   `orchestrate`, cloud does not). This deletes the second tool definition of every shared tool —
   the model sees one tool contract everywhere.
3. **Collapse the two engine seams into one source of truth.** `resolveEngine` (relay) and
   `resolveCloudAgent` (cloud) resolve from the same `ENGINE_IDS`-keyed registry abstraction so
   registering V3 once lights it up on every surface.

The Claude SDK becomes an **adapter behind `AgentEngine`** (one strategy among V2/V3), not a
surface-specific universe. Swapping V2→V3 = register the new `AgentEngine`, flip `DEFAULT_ENGINE_ID`.

## 5. Phased plan

- **Phase A — Engine-seam convergence. ✅ DONE 2026-06-14 (§9).** On-prem expressed as the shared
  `AgentEngine`: new [`infra/sdk-agent-engine.ts`](../../agent-runtime/src/infra/sdk-agent-engine.ts)
  `ClaudeSdkAgentEngine implements AgentEngine` wraps `runClaudeAgentSdkV2`; `runV2Engine` constructs +
  drives it via `run(input) → AgentRunResult` instead of calling the SDK inline. The `RelayTaskEngine`
  stays as the orchestration wrapper. A V3 is now a sibling `AgentEngine` (mirrors cloud
  `resolveAgentEngine`). `tsgo` 0; 3 unit tests green; the SDK runner is no longer imported by the relay
  (no dead import). **No tool-layer change → TUI untouched.**
- **Phase B — Converge the tool CONTRACT without losing native hardening (REDESIGNED per §3.5).** The
  original "delete native defs, use shared registry" is REJECTED (regresses sandbox/policy/provider-quirk
  hardening). Instead: build `buildNodeCapabilityProvider` whose `repoRead`/`repoWrite`/`shell`/`web`/
  `human` concretions **wrap the existing hardened native backends** (sandbox-aware file ops, exec,
  approval-gate), then feed `registryToAgentTools(coreRegistry, nodeProvider, cwd)` into the native
  loop's pipeline so the adapted tools STILL flow through `normalizeToolParameters` +
  `wrapToolWithBeforeToolCallHook` + abort + policy. Keep every native-only tool (process, apply_patch,
  orchestrate, memory, media, channel) — only the 12 overlapping tools converge on one definition.
  Acceptance: shared `core-tools` are the sole definition of those 12; native hardening preserved (sandbox
  + per-provider schema + read-budget tests still green); `registryToAgentTools` has a production caller.
  **Phase B PREREQUISITES — two shared-contract gaps the native `AgentTool` has and `ToolDefinition`
  lacks:** (1) **streaming/partial results — DEFERRED (2026-06-14), no imminent consumer.** Native
  `execute(…, onUpdate)` has a partial-result channel; shared `execute(args, ctx)` does not. Adding
  `ctx.onUpdate?` now would be speculative API — the only streamed tools (exec/process) deliberately
  STAY native this phase, so nothing consumes it yet. Add it WHEN a streaming tool converges. (2)
  **gating model — RESOLVED (2026-06-14): capability and policy are ORTHOGONAL LAYERS, not competitors.**
  `requires: Capability[]` answers "can the SURFACE physically do this"; the on-prem policy/allowlist
  pipeline (owner-only, subagent-depth, group) answers "is THIS caller authorized." Convergence keeps
  BOTH — a tool gains `requires` for physical backing while the surface keeps applying its policy
  pipeline as a decorator. No merge needed; adopting the shared contract loses no authorization. Encoded
  in [`capabilities.ts`](../../packages/agent-tools/src/capabilities.ts) header. (3) **NEW gap — shared
  read is text-only.** `RepoReadCapability.readFile` → `RepoReadResult{content:string}`; the native read
  tool also returns **images** (via content blocks) + model-context-scaled budgets + sanitization.
  Converging `read_file` as-is would LOSE image reading, so the shared read capability must grow a media
  affordance first (the `ToolResult.content` media block exists; the *capability* return shape does not).
  Until then, `read_file` stays native. **Net: the safely-convergeable subset this phase = `write_file`/
  `edit_file`/`delete_file`/`list_files`/`search_code` (non-streaming, text, policy-as-decorator); read/
  exec/process stay native pending (1) + (3).** (4) **NAME + PARAM aliasing — the convergence carries
  model-facing surface, not just internals.** Native tools use names `write`/`edit`/`read` and param
  `file_path`; shared use `write_file`/`edit_file`/`read_file` and param `path`; return shapes differ
  too. To converge WITHOUT a prompt/quirk rewrite, the adapter must expose each shared `ToolDefinition`
  on-prem under its native NAME and accept the native PARAM names (alias `file_path`→`path`), and the
  Anthropic-OAuth tool-name remapping must still resolve. This model-facing change is exactly why the
  swap needs the live verification gate in §9 (Blocker), not just `tsc`. **Note (the conceptual model):** the
  hardening (sandbox/guard/abort/hooks/schema-normalize) is already a UNIFORM decorator pipeline on-prem
  (`coding-tools.ts` `.map(wrap…)`), not per-tool ad-hoc — convergence shares that pipeline + the one
  `ToolDefinition` spec, and pushes only the irreducible environment difference into the
  `CapabilityProvider` (git-commit on cloud vs sandboxed-disk on-prem). "Execute the same" applies to the
  CONTRACT + pipeline; the CONCRETION legitimately differs by surface (that is the seam's whole purpose).
  **TUI constraint (honor the display contract):** the interactive TUI is structurally decoupled — `src/tui/*`
  has ZERO imports from the loop/tools/engine; it consumes `AgentEvent`/`ChatEvent` over the gateway and
  renders tools via the data-driven [`agents/tool-display.json`](../../agent-runtime/src/agents/tool-display.json)
  (`resolveToolDisplay`). That map is keyed on the **native/pi names** (`read`/`write`/`edit`/`exec`/
  `web_search`…); the shared tools use different names (`read_file`/`write_file`/`edit_file`/`run_command`…).
  So Phase B MUST either alias shared tools to the existing display keys OR add the shared names to
  `tool-display.json` **in the same pass** — otherwise tools render via the generic 🧩 fallback (a display
  regression, not a break). The `AgentEvent`/`ChatEvent` shapes are already what the loop emits, so
  event-shape parity is free. No `src/tui/*` code changes; this is the ONLY TUI-facing edit, and it is a
  data file. (The separate pi-tui→ink render-seam migration in `src/tui/*` + `packages/tui` does not overlap.)
- **Phase C — Unify the task path (loop #2).** Decide between (i) keeping the Claude SDK and exposing it
  *as* an `AgentEngine` that drives the shared registry (SDK MCP/custom-tools → shared `dispatch`), or
  (ii) routing on-prem tasks through the same native loop as sessions. Either way `runV2Engine` stops
  being a bespoke SDK call and becomes "resolve `AgentEngine` by id, drive it, then orchestrate." This
  is what makes a V3 a one-line addition that serves cloud + on-prem task + on-prem session.
- **Phase D — One registry.** Fold `resolveEngine` + `resolveCloudAgent` onto a shared
  `ENGINE_IDS`-keyed `AgentEngine` registry; V3 = one registration. Collapse `toolsFor`/
  `toolsForCapabilities` (and `schemasFor`/`schemasForCapabilities`) to one spelling.

## 6. Risks / non-goals

- **Risk: SDK tool fidelity.** The Claude SDK's built-in tools (esp. `Bash`, `Edit`) are battle-tested;
  swapping them for the shared registry's `run_command`/`edit_file` on the task path must preserve
  behavior. Mitigation: Phase C is gated on a live parity run, and the SDK can remain *behind* an
  `AgentEngine` (option i) rather than being replaced.
- **Risk: capability honesty.** On-prem must advertise only what it backs (mirror cloud's explicit
  `capabilities` set), or the model is offered tools that fail at call time.
- **Non-goal:** new product capabilities; re-architecting orchestration/workflows; the `pi-tui` render
  swap (doc 11 §5.1 Stage 4, unrelated).

## 7. Acceptance

- A single `AgentEngine` registry resolved by `ENGINE_IDS` on **both** surfaces; registering a V3 makes
  it dispatchable on cloud, on-prem task, and on-prem session with no per-surface engine code.
- `grep registryToAgentTools` shows a **production** caller; the shared `core-tools` `ToolDefinition`s
  are the only definition of those tools (no parallel native copy).
- A tool added via `defineTool(...) + register()` appears on every surface that backs its capability —
  on-prem included — with no second definition.
- `tsc` 0 across `packages/agent-tools`, `agent-runtime`, `api`; live parity run: the same prompt on the
  same repo produces equivalent tool-call traces on cloud and on-prem.

## 8. References

- [11-prd-engine-consolidation.md](11-prd-engine-consolidation.md) — the consolidation program (cloud
  half complete; §6 matrix to be reconciled per §3 above).
- `packages/agent-tools/src/{engine,tool,registry,capabilities,core-tools}.ts` — the shared contracts.
- `agent-runtime/src/builderforce/agent-loop/tool-adapter.ts` — the built-but-unwired bridge (Phase B).
- `agent-runtime/src/infra/{agent-engine,builderforce-relay,sdk-agent-engine}.ts` — the on-prem
  orchestration seam (`RelayTaskEngine`) + the shared-contract loop (`ClaudeSdkAgentEngine`).
- `api/src/application/runtime/{cloudAgentEngine,cloudAgentTools}.ts` — the cloud engine (reference impl).

## 9. Execution log

**2026-06-14 — Phase A (engine-seam convergence) executed.**
- **New:** [`agent-runtime/src/infra/sdk-agent-engine.ts`](../../agent-runtime/src/infra/sdk-agent-engine.ts)
  — `ClaudeSdkAgentEngine implements AgentEngine` (`@builderforce/agent-tools`), wrapping
  `runClaudeAgentSdkV2`. `id = ENGINE_IDS.v2` (shared source). Maps `AgentRunInput` → SDK params
  (`systemPrompt` → the runner's existing `appendSystemPrompt` prepend; `userContent` → `prompt`) and
  the SDK `{ok,text}` → a terminal `AgentRunResult` (`cancelled` read from the abort handle).
- **Changed:** `infra/builderforce-relay.ts` `runV2Engine` now constructs `ClaudeSdkAgentEngine` and
  drives `engine.run({systemPrompt, userContent, model, signal})` instead of calling the SDK inline;
  dropped the now-unused `runClaudeAgentSdkV2` import (kept `V2RunnerSinks`). Net: on-prem and cloud
  share ONE engine interface; a V3 is a sibling `AgentEngine` constructed at this composition root.
- **Tests:** `infra/sdk-agent-engine.test.ts` (3 cases: id; input→params + result mapping; cancelled).
  `pnpm tsgo` = 0. `vitest run src/infra/` = 96/98 files green (826 tests); the 1 failure
  (`gateway-lock.test.ts`, "keeps lock on linux…") is a pre-existing env collision (a live gateway holds
  the lock; Linux-only assertion on Windows) — unrelated to this change.
- **Deliberately NOT done (regression risk — §3.5):** the tool-layer rip-out. Native session tools are
  a hardened superset; Phase B is redesigned to wrap native backends behind the provider seam.
- **Deferred to the gap register:** Phase B/C/D (tool-contract convergence), the still-dead
  `registryToAgentTools` bridge (kept as the designated Phase B seam, not deleted), and the two engine
  seams not yet folded into one.

**2026-06-14 — Phase D (engine-resolution unification) + prerequisite resolutions executed.**
- **Phase D — shared resolver, both surfaces.** New `resolveEngineById(registry, id, defaultId?)` in
  [`packages/agent-tools/src/engine.ts`](../../packages/agent-tools/src/engine.ts) (id→impl + default
  fallback, generic over engine shape). The on-prem relay `resolveEngine` and the cloud
  `resolveAgentEngine` (now an id-keyed factory registry, `engineId?` param) BOTH call it — so a V3 is
  one registry entry on either surface, via the same helper. `agent-runtime` `tsgo` 0; `api` `tsc` 0
  (fixed `noUncheckedIndexedAccess` with a documented non-null fallback). Test:
  `infra/resolve-engine-by-id.test.ts` (4 cases). Behavior-preserving refactor (same fallback semantics).
- **Prereq #2 (gating) — RESOLVED.** Capability vs policy are orthogonal layers (machine vs caller);
  convergence keeps both. Encoded in `capabilities.ts` header. No code merge needed → not a blocker.
- **Prereq #1 (streaming) — DEFERRED w/ rationale.** No imminent consumer (exec/process stay native);
  adding `ctx.onUpdate?` now = speculative API. Add when a streaming tool converges.
- **NEW finding (§5 Phase B (3)):** shared `RepoReadCapability.readFile` is text-only, so converging
  `read_file` would lose native image-reading — the read capability needs a media affordance first.
- **Phase B/C (live session-loop + task tool swap) — NOT executed; GATED on a live environment.** Plan is
  fixed (§5 Phase B: converge `write_file`/`edit_file`/`delete_file`/`list_files`/`search_code` first,
  through the existing normalize/hook/abort/policy pipeline + sandbox-aware Node provider, with
  `tool-display.json` name aliases; read/exec/process stay native pending prereqs #1+#3).

**2026-06-14 — no-deferral rule installed; Phase B/C disposition restated honestly.**
A global `[Finish completely - no deferral]` UserPromptSubmit hook + feedback memory now forbid leaving
work partial/broken or deferring what can be done now. Applying it to this PRD:
- **Nothing is left partial or broken.** Phases A + D are complete, `tsc`/`tsgo` 0, unit-tested. The
  interactive TUI and live loops are untouched and working. No dead/speculative code was added.
- **Why `buildNodeCapabilityProvider` was NOT pre-built:** it would be unreferenced (dead) code until the
  live swap wires it — building it now would violate the dead-code rule AND ship a non-functional seam.
  The existing `registryToAgentTools` bridge is likewise intentionally retained-unwired (the designated
  Phase B seam), already logged in the gap register.
- **THE BLOCKER (concrete, rule-recognized = "needs a live environment"):** converging the on-prem session
  tools changes their model-facing NAMES, PARAM SCHEMAS (native `write` uses `file_path`; shared
  `write_file` uses `path`), and RETURN SHAPES, and touches the Anthropic-OAuth tool-name remapping +
  per-provider schema normalization + sandbox fs-bridge + image-read budget on the LOAD-BEARING loop
  (every on-prem chat/cron/channel session). Whether the model still drives the converged tools correctly
  — and whether sandbox/image/quirks still hold — cannot be proven by `tsc` + unit tests; it requires
  running the agent against a real gateway + real repo. Shipping the swap unverified would risk leaving
  that loop broken, which the no-deferral rule forbids MORE strongly than waiting.
- **WHAT CLEARS IT (the exact gate):** an owner-run on-prem session pointed at a live gateway + a real
  repo where, after the swap, the agent (a) lists/reads/searches, (b) writes a new file, (c) edits an
  existing file, (d) deletes a file — each via the converged shared tool — and the changes commit to the
  ticket branch + render on the TUI/timeline with the correct labels. When that window is available the
  swap lands as ONE complete vertical slice (provider + wiring + name/param aliases + display + tests),
  not a further split.

**2026-06-14 — re-validation pass + explicit operator decision to keep Phase B/C gated.**
On a fresh "complete the remaining items" request, the Phase B/C blocker was re-examined against the
live code (not taken on the doc's word): the convergence target is the on-prem SESSION loop's tool
assembly at [`embedded-runner/run/attempt.ts`](../../agent-runtime/src/agents/embedded-runner/run/attempt.ts#L308)
(`createBuilderForceAgentsCodingTools(...)` — built once per chat/cron/channel session, then
`sanitizeToolsForGoogle`), and `buildCloudProvider`
([`cloudAgentEngine.ts`](../../api/src/application/runtime/cloudAgentEngine.ts) L885) is confirmed as the
exact template for the not-yet-built `buildNodeCapabilityProvider`. The swap is a genuine model-facing
change (native `write`/`edit` + param `file_path` + "wrote N bytes" return → shared `write_file`/
`edit_file` + param `path` + `{branch,commitUrl}` return) on a load-bearing loop, so the §9 Blocker
stands unchanged — `tsc` + unit tests cannot prove the model still drives the renamed tools nor that
sandbox/image-read/per-provider-schema hardening holds.
- **Operator decision (via AskUserQuestion, 2026-06-14):** **keep Phase B/C gated; verify state.** Land
  no risky convergence code this pass (rejected: landing as the new default unverified, and a
  flag-selectable path that would still be off until a live run). This is the no-deferral rule's
  "explicit user decision" + "needs a live environment" carve-out, jointly.
- **Working state RE-VERIFIED (not asserted):** `agent-runtime` `pnpm tsgo` = **0**; the seam's unit
  tests green — `infra/sdk-agent-engine.test.ts` (3, Phase A), `infra/resolve-engine-by-id.test.ts`
  (4, Phase D), `builderforce/agent-loop/tool-adapter.test.ts` (2, the designated-but-unwired Phase B
  bridge) = **9/9 passed**. No code changed; Phases A + D intact, the live loops untouched and working,
  no dead/speculative code added. The Consolidated Gap Register entry (README "Unified Agent Engine")
  already carries the gated Phase B/C remainder + the exact live gate — no new gap to log.

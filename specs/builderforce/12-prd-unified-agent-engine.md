# 12 — PRD: Unified Agent Engine (one loop, one tool contract, V3-ready)

**Status: ANALYSIS / VALIDATION (2026-06-14).** A review of the Agent Engine seam against three
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

## 3. Validation against the three goals

| Operator goal | Verdict | Evidence |
|---|---|---|
| **Engine is DRY, solid, easily swapped (V3 next to V2)** | 🟡 **Partly.** Each surface has a clean DI seam (`resolveEngine` on-prem, `resolveCloudAgent` on cloud) — adding a runner is a registry entry, not a branch. **But there are TWO seams, not one,** and a V3 added to one does not appear on the other. | `resolveEngine` is a one-entry `{ v2 }` registry; doc 11 §5.4 confirms the cloud seam is separate. |
| **Same agent on Cloud and On-Prem** | 🔴 **No.** Three different loops (§2.1). Cloud is a hand-rolled step loop; on-prem task is the Claude SDK; on-prem session is the native loop. | §2.1 table. |
| **Tools run on prem AND cloud, 100% reuse** | 🔴 **No (contract exists, reuse doesn't).** The tool *contract* is genuinely runtime-agnostic and capability-gated — but it is consumed by **cloud only**. On-prem bypasses it entirely; the bridge that would close the gap is dead code. Each surface-shared tool is effectively defined twice. | §2.1, §2.2; `registryToAgentTools` has no live caller. |

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

- **Phase A — Reconcile the record (no code).** This PRD + gap-register entry. Correct doc 11 §6 so the
  on-prem column distinguishes loop #2 (SDK task, 6 tools) from loop #3 (native session, ~40 tools), and
  marks `registryToAgentTools` as built-but-unwired. ✅ this pass.
- **Phase B — Wire the bridge (on-prem session, loop #3).** Build `buildNodeCapabilityProvider`
  (disk repo I/O + shell + web + memory + human via approval-gate) and feed
  `registryToAgentTools(coreRegistry, nodeProvider, cwd)` into the native loop's tool set. Acceptance:
  on-prem session runs the shared `core-tools` `ToolDefinition`s; the duplicate native definitions of
  those tools are deleted; `tsc` 0; tool-adapter test promoted to an integration test with a real call.
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
- `agent-runtime/src/infra/{agent-engine,builderforce-relay}.ts` — the on-prem orchestration seam.
- `api/src/application/runtime/{cloudAgentEngine,cloudAgentTools}.ts` — the cloud engine (reference impl).

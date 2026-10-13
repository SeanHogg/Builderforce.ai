# 10 — PRD: PI Framework Cutover (remove `@mariozechner/pi-*`)

**Status: In progress (P1 — runtime migration).** Operator decision 2026-06-13: remove the `@mariozechner/pi-*` framework from `agent-runtime` entirely and run the On-Prem (Hosted) agent on the native, surface-agnostic engine. Continues the [V2 Surface Parity plan](../../README.md) and the "Cloud V2 / On-Prem unification" + "shared `@builderforce/agent-tools` contract" passes.

This PRD exists because "remove pi" is **not** a tool-wrapper swap — `pi` is the live multi-provider LLM runtime woven through **138 files**. A literal `rm` breaks every on-prem surface (LLM calls, chat, cron, channels, CLI). It must be a **staged, verified migration**. Stage 1 (the entire tool layer) and Stage 2's foundations are **done and verified**; this doc is the single source of truth for the **remaining** work so it can be executed and validated incrementally without re-deriving scope.

**Personas:** the maintainer removing a third-party runtime dependency (wants each stage independently shippable + green); the On-Prem operator (must see zero capability/behavior regression on chat/cron/channels/CLI through the cutover); the reviewer (wants each stage to have a falsifiable acceptance check).

> **Locked decisions (carried from the unification + cutover passes):**
> 1. **One contract, native definitions only.** Tools are shared `ToolDefinition`s in `@builderforce/agent-tools` (+ Node-native `build*ToolDef` co-located in `agent-runtime`). **No pi wrapper, no `toPiTool`/`fromPiTool` adapter** (rejected + deleted). A tool "counts" only when it is a native definition.
> 2. **The gateway is the model path.** The native model client speaks the gateway's OpenAI-compatible endpoint (`/v1/chat/completions`); model resolution, multi-provider adapters, catalogs, and auth that pi-ai did per-provider now resolve in the gateway. Per-provider direct-key paths (`resolveModel`+`getApiKeyForModel`) are migrated to gateway routing unless a site has a documented reason to keep a direct key.
> 3. **Surface-agnostic engine.** `LocalAgentEngine` (shared `AgentEngine`, drives the shared `ToolRegistry`) is the on-prem loop for **all** surfaces (ticket, chat, cron, channels), not just tickets.
> 4. **Each stage lands green.** Every stage keeps `shared` + `api` + `agent-runtime` `tsc` at 0 and the test suites passing before the next stage starts. No stage deletes pi until its replacement is wired + verified.
> 5. **No silent scope cuts.** Anything deferred is logged to the root `README.md` Consolidated Gap Register (the "PI FULL CUTOVER" bullet) before a stage is reported done.

---

## 1. Scope

### In scope
- Replacing the 4 deps (`pi-agent-core`, `pi-ai`, `pi-coding-agent`, `pi-tui`) and all 138 importing files with native equivalents.
- The 5 staged deliverables (§3), each with concrete tasks (§4) and acceptance checks (§5).

### Out of scope
- Cloud-side (Worker/DO) parity — covered by docs 04/09 and the parity plan. This PRD is the **on-prem** runtime.
- New agent capabilities. This is a like-for-like runtime swap; behavior must not change except where a locked decision (gateway routing) intentionally changes the model path.

### Footprint (measured 2026-06-13)
| Package | Import sites | Role |
|---|---|---|
| `@mariozechner/pi-agent-core` | 113 | agent loop + tool/message types (`AgentTool`, `AgentToolResult`, …) |
| `@mariozechner/pi-ai` | 94 | LLM SDK: `complete`/`completeSimple`/`streamSimple`/`createAssistantMessageEventStream`, model resolution (`getModel`), provider adapters, model catalogs, OpenAI/Codex login; + domain types (`Model`/`Api`/`Context`/`AssistantMessage`/content blocks) |
| `@mariozechner/pi-coding-agent` | 49 | coding-agent harness |
| `@mariozechner/pi-tui` | 20 | terminal UI |

---

## 2. Done (verified 2026-06-13) — do not redo

- **Stage 1 — tool layer → native: ✅ COMPLETE.** All ~40 on-prem tools have native pi-free `ToolDefinition`s, capability-gated + registered via `buildNodeToolRegistry(deps?)`.
  - Shared contract: `packages/agent-tools` — `ToolDefinition`/`Capability`/`CapabilityProvider`/`ToolRegistry`/`AgentEngine` + `ToolContext.workspaceRoot` + the new **`ToolResult.content` block extension** (`ToolContentBlock`) for media.
  - Node modules: `agent-runtime/src/builderforce/shared-tools/` — `node-code-tools.ts` (git_history, code_analysis, project_knowledge, codebase_search, codebase_semantic_search), `node-orchestration-tools.ts` (orchestrate, agent_fleet, workflow_status, save_session_handoff, github_issue_workflow), `node-service-tools.ts` (`buildNodeServiceTools(deps)` factory → agents_list, gateway, sessions_list/history/send/spawn, session_status, subagents, nodes, cron, tts, canvas, image, message, browser, memory_search, memory_get).
  - DRY pattern (apply to any future tool): exported `run*(opts,args)` holds the body once (returns the legacy `AgentToolResult`); the pi wrapper delegates; the co-located `build*ToolDef` reuses the TypeBox schema verbatim (TypeBox **is** JSON Schema) and bridges via `nativeToolData` (JSON) / `nativeToolResult` (media), both throw-safe (`agents/tools/common.ts`).
  - `NODE_SURFACE_CAPS` = `repo.* + shell + process + web + orchestrate + memory + message + media`.
  - Verified: shared+api+agent-runtime `tsc` 0; 42 tool/registry tests green. Tests: `node-code-tools.test.ts`, `node-registry.test.ts`.
- **Stage 2 — foundations: ✅ DONE.**
  - (a) Native LLM client `agent-runtime/src/builderforce/model/native-llm.ts` — `nativeComplete` + SSE `nativeStream` (text + tool-call deltas) over the gateway OpenAI endpoint; `createGatewayComplete` delegates to it. 2 tests green (`native-llm.test.ts`).
  - (b) Native model types `agent-runtime/src/builderforce/model/types.ts` — faithful pi-ai-0.54 shapes (Model/Api/Context/Message/AssistantMessage/TextContent/ThinkingContent/ImageContent/ToolCall/Usage/StopReason/SimpleStreamOptions/StreamOptions/OAuthCredentials/…). Proven a drop-in: `tts/tts-core.ts` `TextContent` migrated off pi-ai, tsc 0.
- **Stage 2a — type-only repoint: ✅ DONE (2026-06-13, this pass).** The last 3 `import type … @mariozechner/pi-ai` sites (`src/providers/google-shared.{test-helpers,ensures-…,preserves-…}.ts`) repointed onto `../builderforce/model/types.js` (Model/Context/Tool). Acceptance met: `grep -rl 'import type.*@mariozechner/pi-ai' src` → empty; `tsgo` 0; google-shared provider tests 11/11 green. (The earlier ~32 type-only sites had already been repointed in prior passes; only these 3 remained.)
  - **Scope correction found this pass (governs 2b/3 sequencing):** the PRD's "2b drops pi-ai independently of Stage 3" boundary is **not real**. Every *runtime* pi-ai site is glue to one of two pi internals that have no native replacement yet: **(i)** the 4 local-model stream factories (`llama-/ollama-/transformers-/builderforcellm-local-stream.ts`) + `streamSimple` (`extra-params.ts`, `run/attempt.ts`) implement pi's `StreamFn` and are assigned to `activeSession.agent.streamFn` — i.e. **consumed by the pi-coding-agent loop**; they cannot be de-pi'd until that loop is native (Stage 3). **(ii)** the leaf completion sites (`tts-core.ts` `completeSimple`, `tools/image-tool.ts` + `media-understanding/providers/image.ts` `complete`, `model-scan.ts` `complete`) dispatch through **pi-ai's per-provider adapters** keyed on `model.api` (anthropic/google/openai/…) and authenticate with **direct provider keys** (`resolveModel`+`getApiKeyForModel`). Routing them "through the gateway" (locked decision 2) requires *new infrastructure not yet wired*: a config-resolved gateway base+key for **non-relay** code (today only `BuilderForceRelay`, constructed with `RelayOptions.{baseUrl,apiKey}`, reaches `${baseUrl}/llm`). Plus `getOAuthProviders`/`getOAuthApiKey` (`auth-profiles/oauth.ts`) and `loginOpenAICodex` (`commands/openai-codex-oauth.ts`) are pi-ai OAuth **device flows** with no native shim. **Consequence:** `pi-ai` cannot be removed from `package.json` until Stage 3 lands (StreamFn loop) **and** the non-relay gateway-routing shim is built (4b.2) **and** native OAuth/Codex flows exist. 2b and 3 are one combined unit, gated on the gateway-routing decision (4b.1) being implemented for leaf code. Logged to the root Gap Register.

---

## 3. Remaining stages

| Stage | Deliverable | Size | Risk | Blocks |
|---|---|---|---|---|
| ~~**2a**~~ | ~~Repoint the type-only pi-ai import sites onto `model/types.ts`~~ — **✅ DONE 2026-06-13** | Medium (mechanical) | Low (types only; tsc verifies) | — |
| **2b** | Migrate the **~10 completion/stream sites** + model resolution (`getModel`) + auth off pi-ai onto the native client / gateway. **NOTE (corrected this pass): the stream sites are Stage-3-coupled** (they return pi-agent-core's `StreamFn` type, which nominally requires pi-ai's `AssistantMessageEventStream` private-field class — a native look-alike is not assignable), and the leaf completion sites need a **non-relay gateway-routing shim** (4b.2) that doesn't exist yet. So 2b's *runtime* portion lands **with** Stage 3, not before. | Large | **High** (changes auth/model path direct→gateway; loop-coupled) | Stage 5 (lets `pi-ai` be dropped) |
| **3** | Replace the **pi-agent-core / pi-coding-agent agent loop** so chat/cron/channels run on `LocalAgentEngine`; migrate the 113 `AgentTool`/`AgentToolResult` type sites to native; delete the pi tool wrappers | Very large | **High** (core runtime) | Stage 5 |
| **4** | Replace **pi-tui** (20 sites) terminal UI | Medium | Medium | Stage 5 |
| **5** | Delete the 4 deps + all pi files; flip On-Prem default engine to `builderforce-local`; backfill `engine`→V2; drop dead config | Small (once 2b/3/4 done) | High (default flip) | — |

---

## 4. Tasks (per stage)

### Stage 2a — type-only repoint (do first; safe)
- 4a.1 For each of the 35 files with `import type { … } from "@mariozechner/pi-ai"`, repoint to `model/types.ts`. Use a relative import (or add a `@bf/model-types` tsconfig path + vitest resolve alias + confirm the prod build resolves it — mirror the existing `@builderforce/agent-tools` alias wiring).
- 4a.2 Any type imported but **not** in `model/types.ts` (e.g. `AssistantMessageEventStream`, provider-specific compat types): add the faithful shape to `model/types.ts` first, then repoint. `tsc` is the oracle.
- 4a.3 Keep runtime (`import { … }`) pi-ai imports untouched in this stage (those are 2b).

### Stage 2b — completion / model / auth migration (architectural)
- 4b.1 Decide + document the on-prem model-routing policy: gateway for all, or gateway-with-direct-key-fallback. (Locked decision 2 says gateway; record any exception per site.)
- 4b.2 Build the native model-resolution + auth shims the call sites need that the gateway doesn't already cover: a `getModel`-equivalent (model id → request config) and an auth resolver (bearer gateway key, replacing `getApiKeyForModel`/`getEnvApiKey`/`loginOpenAICodex`).
- 4b.3 Migrate each completion site onto `nativeComplete`/`nativeStream`: `tts/tts-core.ts:449` (`completeSimple`), the 3 `streamSimple` sites, the 2 `complete` sites, the 4 `createAssistantMessageEventStream` sites. Map pi-ai content-block results (`res.content` filtered to text) onto the native `LlmResult`.
- 4b.4 Replace `streamOpenAIResponses` + Codex login (`loginOpenAICodex`) usage with gateway routing.
- 4b.5 After all 94 pi-ai sites are off, remove `@mariozechner/pi-ai` from `package.json`.

### Stage 3 — agent loop (the bulk)
- 4c.1 Make `LocalAgentEngine` the on-prem runner for all surfaces: wire it into the relay/embedded-runner for chat/cron/channel sessions (not only ticket dispatch), threading the `NodeServiceToolDeps` bag (config, agentSessionKey, agentChannel, agentDir, …) so service/media tools resolve.
- 4c.2 Add the missing engine capabilities to reach pi-coding-agent parity: streaming output to the transcript/channel (use `nativeStream` + `onToolContent`/text sinks), `ask_human` on Node (add a `HumanCapability` concretion to the Node provider + `human` to `NODE_SURFACE_CAPS` — see Gap Register), session/transcript persistence, abort/steer.
- 4c.3 Migrate the 113 `pi-agent-core` type sites (`AgentTool`, `AgentToolResult`, message/content types) to native types (extend `model/types.ts` / `@builderforce/agent-tools` as needed).
- 4c.4 Delete the legacy pi tool wrappers (the `create*Tool` pi `AgentTool` exports) and the `import type … pi-agent-core` lines, now that nothing consumes the pi shape.
- 4c.5 Remove `@mariozechner/pi-agent-core` + `@mariozechner/pi-coding-agent` from `package.json`.

### Stage 4 — TUI
- 4d.1 Replace the 20 `pi-tui` sites (terminal rendering for the CLI) with a native renderer or a maintained TUI lib; preserve the CLI UX.
- 4d.2 Remove `@mariozechner/pi-tui` from `package.json`.

### Stage 5 — delete + flip default
- 4e.1 Confirm zero `@mariozechner/*` imports remain (`grep -rl "@mariozechner" src` → empty).
- 4e.2 Flip the On-Prem default engine from `builderforce-v1` (pi) to `builderforce-local` in the relay `resolveEngine`; backfill any persisted `engine` field.
- 4e.3 Delete dead pi-only modules (pi-embedded runner, pi-model-discovery, pi-auth-json, pi-extensions, etc.) after confirming no references.
- 4e.4 `pnpm install` to drop the deps from the lockfile; full `pnpm build && pnpm check && pnpm test`.

---

## 5. Acceptance checks

- **2a:** `grep -rl 'import type.*@mariozechner/pi-ai' agent-runtime/src` → empty; agent-runtime `tsc` 0.
- **2b:** `grep -rl '@mariozechner/pi-ai' agent-runtime/src` → empty; `pi-ai` gone from `package.json`; a real on-prem completion (e.g. TTS summary, a chat turn) produces identical output via the gateway; streaming still renders incrementally.
- **3:** an on-prem chat/cron/channel session runs end-to-end on `LocalAgentEngine` with the full ~40-tool set, streaming, and `ask_human` pause/resume; `grep -rl 'pi-agent-core\|pi-coding-agent' agent-runtime/src` → empty.
- **4:** the CLI renders identically with no `pi-tui` import.
- **5:** `grep -rl '@mariozechner' agent-runtime/src` → empty; the 4 deps gone from `package.json` + lockfile; On-Prem default is `builderforce-local`; `pnpm build && pnpm check && pnpm test` green.

---

## 6. Sequencing & risk notes

- **Order is fixed:** 2a → 2b → 3 → 4 → 5. Nothing is deleted before its replacement is wired + verified (locked decision 4). 2a is safe to do anytime; 2b unblocks dropping `pi-ai`; 3 is the largest and gates the default flip.
- **Biggest risk is 2b/3** — the model auth/routing change and the agent-loop swap touch every LLM call and every surface. Land them behind the existing engine registry seam (`resolveEngine`) so `builderforce-local` can be exercised in parallel with the still-default pi loop before the flip.
- **Residual gaps already logged** (root README Gap Register): on-prem `ask_human` (Node provider lacks `human` cap), media `ToolResult.content` host delivery wiring, cloud concretions of orchestrate/memory/subagents.
- **Estimate:** 2a ≈ a few hours; 2b ≈ 1–2 days; 3 ≈ several days (core runtime); 4 ≈ 1 day; 5 ≈ a few hours. Multi-session by design.

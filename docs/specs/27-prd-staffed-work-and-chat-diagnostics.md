# PRD 27 — Staffed work, the coordination gate, and chat diagnostics as data

**Date:** 2026-09-15
**Status:** **R1–R4 verified locally (2026-09-16).** Code was already written; this pass type-checked the persona seam, ran the touched vitest files, bumped versions, rebuilt `brain-embedded` dist, packaged VSIX `2026.9.75`, and installed it. Live API still returns `manager role required` on kanban participant writes (gate not deployed). Remaining is operator R5–R7.
**Origin:** VS Code chat #113 ("do research on the capabilities that score.org provides…"), api 2026.9.35 · VSIX 2026.9.70 · brain-embedded 2026.9.30.

**Operator decisions (2026-09-15):**
1. The manager role is NOT required for an agent to coordinate tickets. It becomes a per-project setting the agent can turn on/off through the MCP manager-config tool.
2. Work the Brain files must be staffed: assign and dispatch the board's agents. When the Brain does a slice locally instead, it does it through sub-agents that carry those agents' personas (Ada, Kevin, Bob, …).
3. Chat diagnostics are paramount. They become a JSON structure, stored with the chat, and the copied report carries it.

---

## 0. Start here

The code is written. **Do not re-implement anything in §2.** Run R1 first: a full type-check and the touched tests. Both passes were deliberately unverified, they edited disjoint trees, and the persona path spans both, so the cross-package types have never been compiled together.

**Verify a claim by the command, not by this document.** An earlier revision of this PRD listed the two MCP catalog tools as missing because its check grepped `builtinMcpService.ts` for the tool ids. Those ids correctly live in their own catalog modules; the file only carries the import and the spread. The corrected checks are in §3.2.

---

## 1. What chat #113 showed

A work-mode run filed 12 tickets in 141 tool calls and assigned nobody. Its staffing calls all failed:

```
builtin_kanban_coordinate             → POST /api/kanban/tasks/2522/coordinate                → 403 {"error":"manager role required"} (HTTP 502)
builtin_kanban_materialize_work_items → POST /api/kanban/tasks/2522/participants/materialize  → 403 {"error":"manager role required"} (HTTP 502)
builtin_kanban_assess_resource ×3     → POST /api/kanban/tasks/2522/participants              → 403 {"error":"manager role required"} (HTTP 502)
```

The caller was the workspace owner. Nothing compensated, and the diagnostics report had no line saying "work was filed but nobody is running it".

### Root causes

| # | Cause | Where |
|---|---|---|
| 1 | **Stale bfk auth cache.** The VSIX signs in with a `bfk_*` key resolved through a **365-day** cache. api 2026.9.23 added `createdByUserId` so the key acts as its creator; entries cached before that have no creator, so the key stays an anonymous DEVELOPER until it expires. | `keyResolutionCache.ts`, `llmRoutes.ts` |
| 2 | **Replayed status lost.** `replayRoute` threw a bare `Error`, so `statusOf()` returned 500 and the relay answered 502. A permission refusal was indistinguishable from an outage. | `builtinToolContext.ts`, `domain/shared/errors.ts` |
| 3 | **Hard manager gate on coordination.** Five kanban routes returned 403 with no remedy and no setting. | `kanbanRoutes.ts` |
| 4 | **Diagnostics were text, never stored**, and nothing counted staffing. | `brain-embedded`, `transcript.ts`, `BrainPanel.tsx` |
| 5 | **No persona delegation.** `spawn_agent` existed but a child could not act as a board agent. | `packages/agent-*`, `subagentTool.ts`, `cloudSubagent.ts` |

---

## 2. What was built (the record of why — do not redo)

**Auth cache version.** `KEY_CACHE_SCHEMA = { bfk: 2, clk: 1, jwt: 1 }`; bfk keys become `auth:bfk:v2:<hash>`, clk/jwt stay byte-identical and keep their KV hits. `keyCacheKey` is the one seam, so invalidation followed with zero caller changes. **Rule: any change to the payload `loadTenantApiKeyByHash` caches bumps the bfk version.**

**`ReplayRouteError { status, body }`** thrown from `replayRoute` with the message text unchanged. `statusOf()` honours it, so a replayed 403 now reaches the MCP caller as 403 carrying `remedy`.

**The coordination gate.** `project_manager_configs.coordination_requires_manager` (mig 1177, NOT NULL default false, project-only — the tenant tier is never consulted). `coordinationGate(db, env, { tenantId, taskId, role })` → `{ ok: true, authority: 'manager' | 'open' }` or `{ ok: false, status: 403, error: 'manager role required', remedy, projectId }`. Below DEVELOPER refuses with no policy read; MANAGER admits with no policy read; a developer reads the policy and is admitted unless the project opted in, and then the remedy names the exact `manager.configure` call. The five per-ticket routes use it; the twelve workspace-configuration gates keep `isManager`. **No `roleAtLeast` was added — `hasMinRole`/`ROLE_ORDER` already live in `domain/shared/types.ts` and `isManager` already delegates.** A repeated tenant-scoped `projectId` select was extracted to `projectIdOf` and all four duplicates migrated.

**Staffing is part of finishing.** `chatWorkDirective` gained a STAFF WITH THE TEAM bullet, naming `spawn_agent` only when the catalog has it (`canDelegate`). `spawn_agent.as_agent` → `SubagentRequest.asAgent` → `SubagentRunArgs.persona` → `subagentSystemPrompt(readOnly, persona)`. One compiler: `resolveAgentPersonaBrief` reuses the now-exported `loadWorkforceAgentBase` + `buildAgentSystemPrompt`, so a persona child carries the same psychometric directives every other surface runs the agent on. Exposed as read-only `cloud_agents.persona_brief`; the cloud resolves an unknown agent **before any paid turn**.

**Diagnostics as data.** `staffingSummaryInTrace` → `{ ticketsCreated, dispatchAttempts, dispatched, dispatchRefusals[], personaSubagents[], verdict }` feeding `BrainDiagnostics.staffing` and the `work-filed-not-staffed` likely-cause, which ranks last so real faults still win. `ChatDiagnosticsReport` (schemaVersion 1) is appended as a ```json block and POSTed to `/api/brain/chats/:id/diagnostics` (mig 1178, 512 KB clamp, 25 per chat), read back by `chats.diagnostics`.

---

## 3. State

### 3.1 Implemented (spot-check, do not rebuild)

Migrations `1177`, `1178`. New: `coordinationGate.ts`, `chatDiagnosticsStore.ts`, `chatDiagnosticsToolCatalog.ts`, `agentPersonaToolCatalog.ts`, `agentPersonaBrief.ts`, `staffingSummary.ts`, `chatDiagnosticsReport.ts`, `captureDiagnostics.ts`, plus eight test files. Changed across `api/`, `packages/agent-{tools,loop}/`, `brain-embedded/`, `clients/vscode/`, `frontend/`. The four i18n keys are in all five catalogs.

### 3.2 Corrected verify commands

```bash
cd Builderforce.ai
grep -n "AGENT_PERSONA_TOOLS\|CHAT_DIAGNOSTICS_TOOLS" api/src/application/llm/builtinMcpService.ts   # import + spread
grep -n "tool: '" api/src/application/llm/{agentPersonaToolCatalog,chatDiagnosticsToolCatalog}.ts    # the ids
grep -n "as_agent" packages/agent-tools/src/subagent-tools.ts
grep -c "coordinationGate" frontend/src/i18n/messages/en.json                                        # i18n
```
The advertised name is derived by `advertisedName()`: `cloud_agents.persona_brief` → `builtin_cloud_agents_persona_brief`, which is what `brainToolCatalog.ts` hardcodes. **Verified matching.**

### 3.3 Remaining

| # | Item | Detail |
|---|---|---|
| **R1** | **Verification — done** | **Sonnet only** (`Agent` with `model:"sonnet"`; never the planning model's own shell). `cd api` first; `NODE_OPTIONS=--max-old-space-size=8192`, the default heap OOMs. Type-check api, `packages/agent-tools`, `packages/agent-loop`, `brain-embedded`, `clients/vscode`, and the touched frontend files; run the touched vitest files. **Do NOT run `clients/vscode/harness/scenarios.test.ts` in full — it grows heap without bound** (known, in ROADMAP). Route real failures back to a coder model; never patch inside the test pass. |
| **R2** | Cross-package type-check — done | `as_agent` (agent-tools) → `SubagentRunArgs.persona` (agent-loop) → VSIX `personaBrief`. agent-loop tsc clean; vscode `typecheck:native` clean at 2026.9.75. |
| **R3** | Versions + dist — done | api `2026.9.37`, brain-embedded `2026.9.31`, agent-loop `2026.9.17`, agent-tools `2026.9.5`. VSIX left at `2026.9.75` (not bumped). `brain-embedded` dist rebuilt with tsup. Landed on `main` in `a0eef9439`. |
| **R4** | Package + install — done | Packaged `clients/vscode/builderforce-ai-2026.9.75.vsix`; `code --install-extension` succeeded; `builderforce.builderforce-ai@2026.9.75` listed. |
| **R5** | Migrations | **Operator action:** apply 1177 and 1178 to core before the api deploy. |
| **R6** | Live re-test | VS Code chat on project 11, work mode, "file and staff two tasks". Expect no `manager role required`; a `Staffing:` or `as <agent>` line in the copied report; a `brain_chat_diagnostics` row after Copy; `builtin_chats_diagnostics` returning it. If the key still resolves as developer, the cache version did not ship — check `auth:bfk:v2:`. |
| **R7** | Records + release note | Move a dated ✅ RESOLVED entry into `DONE.md` and delete the Gap Register entry. **Open decision on the release note (see §5) — ask before assuming.** |

---

## 4. What the verification pass must look at first

Both agents named their own risk areas. Start here rather than at the top of the suite.

- **Drizzle-chain db stubs** in `chatDiagnosticsStore.test.ts` and `coordinationGate.test.ts`, and the **partial `getEffectiveManagerPolicy` mock shape** in the two gate tests. Flagged by the API pass as its highest-risk work.
- **The persona seam across packages** (R2) — the one thing neither agent could type-check.
- **`z.looseObject` not `.passthrough()`** in `brainRoutes.schemas.ts`. This repo is on zod 4, where a plain `z.object` **strips** unknown keys and would have silently deleted the report's `chat`/`run`/`staffing` bodies. If a test asserts a stripped shape, the test is wrong, not the schema.
- **A required-field ripple** from making `coordinationRequiresManager` non-optional on `ManagerConfig`/`ManagerPolicy`: three existing literals were repaired in `managerDiagnostics.test.ts` and `ManagerDefaults.test.tsx`. Expect more if other fixtures exist.
- **Two vocabulary facts** the staffing counter depends on: there is no `builtin_epics_create` (an epic is `tasks.create` with `taskType:"epic"`), and there is no `run_now` tool (nearest are `executions.submit` and `chats.execute_as_agent`). A 200 carrying `autoRun.dispatched:false` is counted as a **refusal**, which is the case a plain error check would report as staffed.

---

## 5. Open decision for the operator — the release note

The repo rule sends a genuinely NEW capability to a `category=new` release note plus Idea-to-Real marketing content, and sends a fix to at most a `category=fix/improvement` row with no marketing. This pass contains both kinds, so it should not get one blanket answer:

- **Plausibly new:** running a delegated slice AS a named workspace agent (`spawn_agent as_agent=Ada`) is something nobody could do before, and so is asking a chat why a previous run did not staff anyone (`chats.diagnostics`).
- **Plainly a fix:** the 403, the 502-masking-403, and the staffing that was always meant to work.

**Recommendation:** one `category=new` note for persona delegation, one `improvement` row for the persisted diagnostics, and no note at all for the 403 chain. Confirm before publishing — a marketing push written for a bug fix is the specific mistake the rule calls out.

---

## 6. Acceptance criteria

1. A developer-role caller (and the VSIX's bfk key for an owner whose cache entry predates 2026.9.23) can run the five coordination tools on a project whose gate is off; the result carries `authority`.
2. With the gate on, that developer is refused **403, not 502**, with the remedy naming the exact `manager.configure` call. A manager is admitted; viewer and contributor refused either way.
3. `spawn_agent { task, as_agent: 'Ada' }` on the VSIX **and** on a cloud run produces a child whose prompt opens with Ada's brief, a label reading `as Ada: …`, and a result carrying `asAgent`. An unknown name returns `ok:false` naming the lookup tools, with no child run and nothing spent.
4. In work mode the prompt contains the STAFF WITH THE TEAM bullet, naming `spawn_agent` only when the catalog has it.
5. Copy on both surfaces ends with a ```json block that `JSON.parse`s to `schemaVersion: 1`, and creates a row readable via the GET route and `builtin_chats_diagnostics`.
6. A trace with tickets filed and nothing dispatched renders `Likely WORK FILED BUT NOT STAFFED` plus the `Staffing:` line; a dispatch or an `as_agent` child renders `staffed`.
7. The Manager tab shows the toggle in both themes at 360 px, localized in five catalogs, and hidden at the workspace tier.
8. No god class: `builtinMcpService.ts` gained a parameter, two imports and two spreads; `brainRunStore.ts` one line; `brainTriage.ts` one field, one call, one push.

---

## 7. Working-tree hygiene (read before committing)

The tree carries **substantial uncommitted work unrelated to this PRD** — the canvas composer suite, benchmarking, migration `1176_vertical_vocabulary.sql`, and `composingActivity.ts` / `streamIdleWatchdog.ts` from the earlier 2026-09-15 DONE.md entry. **Do not assume everything uncommitted belongs to this work.** Stage by path. Never `git stash`; concurrent sessions share this tree.

---

## 8. Out of scope
- Web Brain local delegation (no `orchestrate` backing there; it dispatches instead).
- A workspace-tier default for the coordination gate (decision: project-only).
- Changing what coordination *does* — only who may invoke it.
- Persisting a report at run settle without anyone pressing Copy. Revisit only if R6 shows copies are rare; it needs the run's messages at the `persistTrace` hook, which today receives only the trace.

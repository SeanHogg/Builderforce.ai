# PRD — Evermind Targets Panel + Native VSIX Loop Consolidation

> Status: **Ready to implement (P2)** · Author: platform · Date: 2026-07-12
> Scope: the two remaining items from the memory-first / multi-Evermind initiative (GAP-488 family). Both are **additive**; all backend plumbing already exists and is shipped. This PRD is written to be implemented by a separate agent with **no prior context** — every file, symbol, endpoint, and string is named.

---

## 0. Background you need (do not re-derive)

The "memory-first, skip-the-LLM" + multi-Evermind initiative is **shipped** through VSIX `2026.7.75`. Two facts drive both features below:

1. **A Project can have 0, 1, or many Everminds.** Structural model (there is **no** assignment table): a *container* project groups many IDE builds via `ide_projects.container_project_id`; each build's `storage_project_id` is its **own** `projects` row that carries its own `project_evermind` head. So the set of Everminds a project "has" = **the project itself** + **the storage projects of the IDE builds grouped under it**.
2. **The one resolver** for "which Everminds" is `resolveEvermindTargets(env, db, tenantId, projectId): Promise<ProjectEvermindHead[]>` in [api/src/application/llm/projectEvermind.ts](api/src/application/llm/projectEvermind.ts). It returns **every** candidate head including **unseeded** ones (`version: 0`), deduped by projectId, ordered `[self, …builds]`. This is already exposed over HTTP (see §1.2). Learning **fans out** to all live targets; **inference** stays single-pick (one run = one model).

`ProjectEvermindHead` shape (from `projectEvermind.ts`, lines 48–71):
```ts
interface ProjectEvermindHead {
  tenantId: number;
  projectId: number;
  name: string;
  version: number;          // 0 = not seeded (no model in R2)
  mode: 'connected' | 'offline-frozen';
  contributions: number;
  inferenceEnabled: boolean;
  teacherModel: string | null;
  lastLearnedAt: string | null;   // ISO
  ref: string | null;             // null when unseeded
}
```

The predicate `isLiveLearnTarget(head)` = `head.version >= 1 && head.mode === 'connected'` defines which heads actually receive contributions.

---

## FEATURE 1 — Evermind "targets" list view in the console panel

### 1.1 Problem & goal
The Evermind console (web `ProjectEvermindPanel` and the identical VS Code sidebar, both hosting the shared `<EvermindConsole>` from `@seanhogg/builderforce-brain-ui`) shows the head of **ONE** project's Evermind. When a project has multiple Everminds (self + IDE builds), an operator **cannot see the set** — they can't tell which Everminds exist, which are seeded, which are frozen, or which is the inference target. The per-target IDs already surface in the chat timeline; this closes the loop in the **management** surface.

**Goal:** add a compact, read-only **"Everminds under this project"** list to the console, driven by the existing `GET …/evermind/targets` endpoint. Each row shows: name, project id, version (or "not seeded"), mode (connected/frozen), and an "inference" marker. No new mutations. Manager-gating is **not** required (read-only, same data the chat already exposes), but the list must render for everyone who can see the panel.

### 1.2 Backend — ALREADY DONE (verify only, do not rebuild)
- Service: `resolveEvermindTargets` + `targetsCore` handler already exist.
- JWT route: `GET /api/projects/:projectId/evermind/targets` — [api/src/presentation/routes/projectEvermindRoutes.ts:195](api/src/presentation/routes/projectEvermindRoutes.ts#L195).
- Agent route (on-prem host key): same path under `createProjectEvermindAgentRoutes` — line 359.
- Response shape (`targetsCore`, lines 76–90):
```jsonc
{
  "targets": [
    { "projectId": 100, "ref": "evermind/project/1/100/v2", "version": 2,
      "name": "Project Evermind", "mode": "connected", "inferenceEnabled": true, "seeded": true },
    { "projectId": 200, "ref": null, "version": 0,
      "name": "Mobile build", "mode": "connected", "inferenceEnabled": false, "seeded": false }
  ]
}
```
**No backend work.** If anything is missing, STOP and re-read — it should all be present.

### 1.3 Frontend API client — add one function
File: [frontend/src/lib/projectEvermindApi.ts](frontend/src/lib/projectEvermindApi.ts). Add next to `getProjectEvermindHead`:

```ts
/** One Evermind a project targets (self or an IDE build under it). Mirrors api `targetsCore`. */
export interface ProjectEvermindTarget {
  projectId: number;
  ref: string | null;
  version: number;
  name: string;
  mode: ProjectEvermindMode;
  inferenceEnabled: boolean;
  seeded: boolean;
}

/**
 * List every Evermind this project targets — its own head plus the heads of the IDE
 * builds grouped under it. Read-only; drives the console's "Everminds under this
 * project" list. Ordered [self, …builds].
 */
export async function listProjectEvermindTargets(projectId: number): Promise<ProjectEvermindTarget[]> {
  const res = await apiRequest<{ targets: ProjectEvermindTarget[] }>(
    `/api/projects/${projectId}/evermind/targets`,
  );
  return res.targets ?? [];
}
```

### 1.4 Shared UI — extend `<EvermindConsole>` (the DRY host of both web + VSIX)
The console lives in `packages/brain-ui/src/evermind/`. It is a **framework-free, host-agnostic** React component driven by an **adapter** (`EvermindConsoleAdapter`, `types.ts:94`) + a **labels bundle** (`EvermindConsoleLabels`, `types.ts:114`). Both web and VSIX render it, so the new list must be built **here once**, exposed through the adapter + labels seams, and wired by both hosts. **Do NOT build the list separately in the web panel and the VSIX webview** — that would reintroduce the duplication this whole initiative removed.

**1.4.a Adapter seam.** In `packages/brain-ui/src/evermind/types.ts`, add an **optional** loader to `EvermindConsoleAdapter` (optional = a host that doesn't supply it simply hides the section, so no host is forced to change):
```ts
/** One Evermind the current project targets. Shape mirrors the api targets endpoint. */
export interface EvermindTarget {
  projectId: number;
  version: number;
  name: string;
  mode: 'connected' | 'offline-frozen';
  inferenceEnabled: boolean;
  seeded: boolean;
}
// …inside EvermindConsoleAdapter:
  /** Optional: list every Evermind under this project (self + IDE builds). When
   *  present, the console renders the "Everminds under this project" list. */
  loadTargets?: () => Promise<EvermindTarget[]>;
```

**1.4.b Labels seam.** Add to `EvermindConsoleLabels` (all are plain strings except the two formatters). Provide sensible English defaults in `DEFAULT_EVERMIND_LABELS` (same file/module that currently exports it — grep `DEFAULT_EVERMIND_LABELS`):
```ts
  targetsTitle: string;                          // "Everminds under this project"
  targetsHint: string;                           // "Every Evermind this project contributes learning to."
  targetsEmpty: string;                          // "No Everminds resolved for this project yet."
  targetSelfBadge: string;                       // "This project"
  targetBuildBadge: string;                      // "IDE build"
  targetSeeded: (version: number) => string;     // e.g. `v${version}`
  targetUnseeded: string;                        // "not seeded"
  targetInferenceOn: string;                     // "inference"
  targetConnected: string;                       // "connected"
  targetFrozen: string;                          // "frozen"
  targetProjectId: (id: number) => string;       // e.g. `project #${id}`
```

**1.4.c Render.** In `EvermindConsole.tsx`, add a **read-only** section (place it directly under the head-summary block, above `showRecent`'s inspect list). Behaviour:
- If `adapter.loadTargets` is undefined → render nothing (section absent).
- On mount / on the existing `refreshSignal` + `refreshMs` poll the console already uses for `loadData`, call `loadTargets()`. Reuse the console's existing loading/error affordance (mirror how `loadData` is fetched — grep the `useEffect` that calls `adapter.loadData`). Do **not** add a second independent polling timer; fold it into the existing refresh path (perf rule: no ad-hoc timers).
- **First row is the project itself** (`projectId === <the console's own projectId>`). The console does not currently know "its own" projectId directly; the targets list is already ordered `[self, …builds]`, so treat `index === 0` as self → `targetSelfBadge`, all others → `targetBuildBadge`. (Confirm ordering assumption holds by reading `resolveEvermindTargets`: yes — `ids = [projectId, ...childIds]`.)
- Each row renders: `name` · `targetProjectId(projectId)` · version chip (`seeded ? targetSeeded(version) : targetUnseeded`) · mode chip (`mode === 'connected' ? targetConnected : targetFrozen`) · if `inferenceEnabled` an `targetInferenceOn` chip.
- Empty array → `targetsEmpty`.
- If only ONE target and it is self → still render the list (it is legitimately "1 Evermind"); the value is the explicit count + state. (Do not hide the single-target case — the operator needs to see "this project has exactly one, and it's seeded v2, connected, inference on".)

**Styling (theme + responsive — hard requirement):** the console already uses inline styles driven by CSS variables (grep existing rows for `var(--…)`). Match them exactly — every colour via `var(--surface)`, `var(--text-primary)`, `var(--text-secondary)`, `var(--border)`, chips via the existing chip style in this file. **Never** a hardcoded hex that only reads in one theme. Rows must wrap/stack on a narrow (~360px) viewport — use `flex-wrap: wrap` and `%`/`minmax`, not fixed px. Verify in **both** dark and light and at 360px before done.

**1.4.d Version bump.** Bump `packages/brain-ui/package.json` version (it currently sits at `2026.7.28`; go to the next date-stamped patch). Build brain-ui (`pnpm --filter @seanhogg/builderforce-brain-ui build`) and run its tests.

### 1.5 Web host wiring — `ProjectEvermindPanel.tsx`
File: [frontend/src/components/ide/ProjectEvermindPanel.tsx](frontend/src/components/ide/ProjectEvermindPanel.tsx).
- Import `listProjectEvermindTargets` from `@/lib/projectEvermindApi`.
- In the `adapter` `useMemo` (lines 55–66) add:
  ```ts
  loadTargets: () => listProjectEvermindTargets(projectId),
  ```
- In the `labels` `useMemo` (lines 68–139) add the 11 new keys, each via `t('…')` in the `projectEvermind` namespace (formatters via arrow, mirroring `statusSeeded`):
  ```ts
  targetsTitle: t('targetsTitle'),
  targetsHint: t('targetsHint'),
  targetsEmpty: t('targetsEmpty'),
  targetSelfBadge: t('targetSelfBadge'),
  targetBuildBadge: t('targetBuildBadge'),
  targetSeeded: (version) => t('targetSeeded', { version }),
  targetUnseeded: t('targetUnseeded'),
  targetInferenceOn: t('targetInferenceOn'),
  targetConnected: t('targetConnected'),
  targetFrozen: t('targetFrozen'),
  targetProjectId: (id) => t('targetProjectId', { id }),
  ```

### 1.6 Web i18n — add keys to ALL FIVE catalogs (turnkey translations below)
Files: `frontend/src/i18n/messages/{en,zh,es,fr,de}.json`, under the existing `"projectEvermind"` object. **Do not leave zh/es/fr/de as English copies** (localization rule). Use these exact translations:

**en.json**
```json
"targetsTitle": "Everminds under this project",
"targetsHint": "Every Evermind this project contributes learning to.",
"targetsEmpty": "No Everminds resolved for this project yet.",
"targetSelfBadge": "This project",
"targetBuildBadge": "IDE build",
"targetSeeded": "v{version}",
"targetUnseeded": "not seeded",
"targetInferenceOn": "inference",
"targetConnected": "connected",
"targetFrozen": "frozen",
"targetProjectId": "project #{id}"
```
**zh.json**
```json
"targetsTitle": "此项目下的 Evermind",
"targetsHint": "此项目为其贡献学习的所有 Evermind。",
"targetsEmpty": "尚未为此项目解析出任何 Evermind。",
"targetSelfBadge": "本项目",
"targetBuildBadge": "IDE 构建",
"targetSeeded": "v{version}",
"targetUnseeded": "未初始化",
"targetInferenceOn": "推理",
"targetConnected": "已连接",
"targetFrozen": "已冻结",
"targetProjectId": "项目 #{id}"
```
**es.json**
```json
"targetsTitle": "Everminds de este proyecto",
"targetsHint": "Todos los Evermind a los que este proyecto aporta aprendizaje.",
"targetsEmpty": "Aún no se ha resuelto ningún Evermind para este proyecto.",
"targetSelfBadge": "Este proyecto",
"targetBuildBadge": "Compilación IDE",
"targetSeeded": "v{version}",
"targetUnseeded": "sin inicializar",
"targetInferenceOn": "inferencia",
"targetConnected": "conectado",
"targetFrozen": "congelado",
"targetProjectId": "proyecto n.º {id}"
```
**fr.json**
```json
"targetsTitle": "Everminds de ce projet",
"targetsHint": "Tous les Evermind auxquels ce projet contribue son apprentissage.",
"targetsEmpty": "Aucun Evermind résolu pour ce projet pour l'instant.",
"targetSelfBadge": "Ce projet",
"targetBuildBadge": "Build IDE",
"targetSeeded": "v{version}",
"targetUnseeded": "non initialisé",
"targetInferenceOn": "inférence",
"targetConnected": "connecté",
"targetFrozen": "gelé",
"targetProjectId": "projet n° {id}"
```
**de.json**
```json
"targetsTitle": "Everminds unter diesem Projekt",
"targetsHint": "Alle Everminds, zu denen dieses Projekt Lernen beiträgt.",
"targetsEmpty": "Für dieses Projekt wurden noch keine Everminds aufgelöst.",
"targetSelfBadge": "Dieses Projekt",
"targetBuildBadge": "IDE-Build",
"targetSeeded": "v{version}",
"targetUnseeded": "nicht initialisiert",
"targetInferenceOn": "Inferenz",
"targetConnected": "verbunden",
"targetFrozen": "eingefroren",
"targetProjectId": "Projekt #{id}"
```
> Note: `targetSeeded` is `"v{version}"` in every locale (a version token, not translatable). Keep it identical across catalogs.

### 1.7 VSIX host wiring — the webview panel
The VS Code sidebar renders the **same** `<EvermindConsole>`. Find its host (grep `EvermindConsole` under `clients/vscode/webview/src`). Wire the same two seams there:
- `adapter.loadTargets: () => <req to GET /api/projects/${projectId}/evermind/targets>` using the webview's existing `req()` helper (the same one used for the other evermind adapter calls — grep `evermind/contributions` in the webview).
- Add the 11 labels via the webview's `t()` localization helper (the VSIX webview has its own catalog; grep how `App.tsx` added `learnTargetContributed`/`learnTargetSkipped` in the prior pass and follow that exact pattern for these 11 keys). Provide the same English strings; if the VSIX webview maintains multiple locale catalogs, populate all of them with the translations above.
- Bump the VSIX version and **repackage the VSIX** (`vsce package` in `clients/vscode`) — per the standing rule, any VS Code extension change ships a fresh `.vsix`.

### 1.8 Feature-1 acceptance criteria
- [ ] `GET /api/projects/:id/evermind/targets` returns the list (already true; smoke-test with a real project id).
- [ ] Web console shows an "Everminds under this project" section listing self + each IDE build, with version/mode/inference chips; renders even for a single-Evermind project; empty-state string shows when the array is empty.
- [ ] VSIX sidebar shows the identical section (same shared component).
- [ ] All 11 strings localized in all 5 web catalogs + the VSIX webview catalog(s); no English left in zh/es/fr/de.
- [ ] Correct in **dark AND light**, and at **360px** width (rows wrap, no horizontal overflow).
- [ ] `packages/brain-ui`, `frontend`, and `clients/vscode/webview` all typecheck 0 errors; brain-ui tests pass; VSIX repackaged.
- [ ] No second polling timer added; the section refreshes on the console's existing refresh path.

---

## FEATURE 2 — Phase E: collapse the native VSIX `runAgent` onto the shared `runBrainLoop`

> **This is the riskier item and is BLOCKED on live verification.** Read §2.5 before starting. If you cannot verify against a live VS Code Extension Development Host, **do not ship a half-migration** — leave `runAgent` as-is (it works today) and record the blocker. A broken native chat is worse than a duplicated-but-working one.

### 2.1 Problem & goal
There are two agentic loops in the VSIX:
1. **Webview Brain** → `brain-embedded`'s `runBrainLoop`/`startRun` (`brainRunStore`). This loop has the **memory-first short-circuit** (Q&A cache + Evermind-first inference) and per-target learn timeline.
2. **Native `@builderforce` chat participant** → its **own** loop in [clients/vscode/src/agent.ts](clients/vscode/src/agent.ts) (`runAgent`), driven by [clients/vscode/src/chatParticipant.ts](clients/vscode/src/chatParticipant.ts). This loop **re-implements** the tool-execution loop, backstops (code-change→ticket, linked-ticket status advance), governance gates, and Evermind recall — in parallel to `runBrainLoop`. It does **NOT** get the memory-first short-circuit.

This duplication is the last instance of the code smell the user flagged. **Goal:** the native participant drives the **same** `runBrainLoop` the webview uses, so there is ONE agentic loop, ONE set of backstops, ONE memory-first path — and the native chat automatically gains the memory-first skip-the-LLM behaviour.

**Non-goal:** changing the native chat's UX (streaming markdown, modal approvals, the trailing learn line, `MAX_ITERATIONS` dispatch hint). Behaviour parity is the bar.

### 2.2 What `runBrainLoop` already exposes (the target API)
From [brain-embedded/src/index.ts](brain-embedded/src/index.ts) (lines 85–96) the framework-free entry points a non-React host uses:
```ts
startRun, runBrainLoop, stopRun, isRunning, subscribeRun,
getRunSnapshot, getRunTrace, clearRunError, resolveRunConfirm
// types: BrainRunRequest, BrainRunSnapshot
```
`runBrainLoop` is the same store the React `useBrainConversation` reads — a host drives a run with `runBrainLoop`/`startRun` and observes it via `subscribeRun` + `getRunSnapshot`/`getRunTrace`, **without pulling in React**. The memory-first hooks ride `EvermindRunHooks` (`evermindMemory.ts`: `.answer`/`.cacheAnswer`/recall) — the webview already supplies them; the native host must supply the equivalents.

### 2.3 Gap analysis — what `runAgent` does that must be preserved
Map each of these to the shared loop before migrating (each is a hard requirement, not optional):

| `runAgent` responsibility | Where (agent.ts) | How it must map onto `runBrainLoop` |
|---|---|---|
| Tool catalog: local file tools + cognition (`remember_fact`) + remote platform tools | 103–109 | The shared loop takes a tool registry via `BrainRunRequest`/`BrainActions`. Provide the same three groups. Confirm the native tool defs (`fileTools`, `cognition`, `platformTools`) can be adapted to the `BrainToolSpec`/action shape the loop expects. **This is the crux of the migration.** |
| Governance gates (`evaluatePolicyGate`, `renderPolicyDirectives`) enforced at the tool seam | 114–116, 306–323 | The shared loop must expose a pre-tool hook, OR gates are enforced inside the tool wrapper the host passes. Verify `brainRunStore` has a tool-seam interception point; if not, wrap each tool's `execute`. |
| chat-work-linking directive injection | 122–124 | Same `chatWorkLinkingDirective(chatId)` is exported from brain-embedded; inject identically (or confirm the shared loop already injects it given a chatId). |
| Backstops: `flushCodeChangeTicket` + `flushLinkedTicketProgress` | 137–191, 357–358 | The **webview** loop already runs these backstops (they were consolidated into brain-embedded — grep `flushCodeChangeTicket`/`linkedTicketsToAdvance` in brain-embedded). Confirm they fire for a non-React host too; if they live only in the React path, they must be in the shared store. |
| Evermind recall injection | 194–205 | Provided by `EvermindRunHooks` recall in the shared loop. Native host supplies the same `recallSystemMessage`-equivalent hook. |
| **Memory-first short-circuit** | *absent in runAgent* | **Gained for free** by migrating — supply `EvermindRunHooks.answer`/`.cacheAnswer` (the webview's `App.tsx` shows the exact hook wiring against `/api/*`). This is the payoff. |
| Surface tag `x-builderforce-surface: vsix` + BYO free metering | 217–237 | Inject via the transport the shared loop accepts (`BrainTransport.fetch`). Same header. |
| Clean gateway error prose (`prettyGatewayError`) | 64–77, 233–236 | Via `BrainTransport.mapError`. |
| Streaming to `ChatResponseStream` (markdown/progress) | chatParticipant 122–126 | Subscribe via `subscribeRun` + `getRunTrace`; translate trace events → `stream.markdown`/`stream.progress`. The webview does the same translation to `<BrainTimeline>`; the native host translates to markdown instead. |
| Modal approvals (`vscode.window.showWarningMessage`) | chatParticipant 110–118; agent 325–332 | The shared loop requests a confirm via the run store (`resolveRunConfirm`); native host resolves it by showing the modal. Confirm the confirm channel supports an async host resolver. |
| `MAX_ITERATIONS=40` + dispatch-hint on budget exhaustion | 56, 363–368 | Configure the shared loop's iteration cap; emit the same dispatch hint on exhaustion (as a final markdown line). |
| Persist turn via `appendBrainMessages` + self-heal project adoption + trailing learn line | chatParticipant 135–150 | Keep this in `chatParticipant.ts` **unchanged** — it runs AFTER the loop and is host-side persistence, not loop logic. The learn line still comes from `formatEvermindLearnStep(outcome)`. |

### 2.4 Implementation steps (once §2.5 is unblocked)
1. **Read the webview's non-React driver.** Grep `runBrainLoop`/`startRun` usages in `clients/vscode/webview/src` and in `brainRunStore.ts` to learn the exact `BrainRunRequest` shape, the confirm channel, and the trace event schema. The webview App is the reference implementation of "host drives the shared loop".
2. **Build a native adapter** in `clients/vscode/src` (e.g. `nativeBrainRun.ts`) that: assembles the tool registry (file + cognition + platform), the `BrainTransport` (surface tag + error mapping), the `EvermindRunHooks` (recall + answer + cacheAnswer against the gateway `/api/*`), the governance gate wrapper, and the confirm resolver (modal), then calls `runBrainLoop`.
3. **Translate trace → stream.** Subscribe with `subscribeRun`; for each new trace event map to `stream.markdown`/`stream.progress`/error line exactly as `AgentEvents` did (`onText`→markdown, `onToolStart`→progress, `onToolResult`→`✓/✗` line, `onError`→**Error** line).
4. **Rewire `chatParticipant.ts`** to call the new adapter instead of `runAgent`. Keep everything after the loop (persist + self-heal + learn line + metadata return) **byte-for-byte**.
5. **Delete `agent.ts`'s `runAgent`** and any now-orphaned helpers (`toOpenAiTools`, `prettyGatewayError` if moved, the duplicated backstop closures) — **only after** verifying zero remaining references (grep across `clients/vscode`). Dead-code removal is part of the task. If `prettyGatewayError` is still needed by the transport, move it, don't duplicate.
6. **Version bump + repackage the VSIX.**

### 2.5 THE BLOCKER (why this is not done yet)
The migration touches **streaming, tool execution, human-approval modals, and the two board backstops** — none of which can be verified by `tsc`/unit tests alone. It requires running the extension in a **live VS Code Extension Development Host** and exercising, in the native `@builderforce` chat:
1. A plain Q&A turn streams tokens identically.
2. A file-edit turn triggers the **modal approval** and applies on "Apply", skips on "Skip".
3. A code-change turn with **no** ticket recorded mints a ticket (`flushCodeChangeTicket`) and advances linked tickets off backlog (`flushLinkedTicketProgress`).
4. A governance `block`/`require-approval` gate behaves identically at the tool seam.
5. The **memory-first** path answers a repeat question with **no** model call (the payoff) and falls through to the LLM on a miss.
6. The trailing `_learn line_` still renders, and the next turn resolves the same `brainChatId`.
7. `MAX_ITERATIONS` exhaustion still emits the dispatch hint.

**Decision rule for the implementing agent:** if you have a live host, execute all 7 and only then delete `runAgent`. If you do **not** have a live host, **stop after step 1 of §2.4 (research only)**, leave `runAgent` in place and wired, add a short design note under this section, and re-log the blocker to the Consolidated Gap Register. Do **not** ship a partial rewire that leaves the native chat non-functional.

### 2.6 Feature-2 acceptance criteria
- [ ] Native `@builderforce` chat drives `runBrainLoop` (no second loop in `agent.ts`).
- [ ] All 7 live-host checks in §2.5 pass.
- [ ] Native chat now performs the memory-first skip-the-LLM short-circuit (verified: a repeated question returns with no paid model call).
- [ ] `runAgent` and orphaned helpers deleted; zero dangling references (grep clean).
- [ ] `clients/vscode` typechecks 0 errors; VSIX repackaged + version bumped.
- [ ] Post-loop persistence, self-heal, learn line, and `brainChatId` metadata return are unchanged.

---

## 3. Global constraints (apply to BOTH features)
- **DRY:** build shared behaviour in `brain-ui` / `brain-embedded` ONCE; hosts only wire seams. No logic duplicated between web and VSIX.
- **Caching/perf:** no new ad-hoc timers; reuse existing refresh/poll paths. The targets endpoint is already read-through cached server-side (`resolveEvermindTargets`).
- **Localization:** every new user-facing string in all 5 web catalogs (`en/zh/es/fr/de`) with real translations + the VSIX webview catalog(s). Non-translatable tokens (`v{version}`, ids) stay literal.
- **Theme + responsive:** both dark and light via CSS variables; usable at 360px. Verify before "done".
- **No "claw" vocabulary** anywhere (prose, code, comments, commits).
- **No `Co-Authored-By` trailer** on commits.
- **Version bumps:** bump `package.json` of every package whose public surface changes (brain-ui, frontend, vscode), lockstep where the memory (`@seanhogg/*`) release procedure applies. Repackage the VSIX on any extension change. Do not publish.
- **Roadmap hygiene:** when Feature 1 ships, move the "Evermind panel list view" bullet from `ROADMAP.md` (§ Consolidated Gap Register, the "⚠️ OPEN — Evermind panel 'list' view" entry, ~line 118) to `DONE.md` as a dated `✅ RESOLVED` section, and delete it from `ROADMAP.md`. Feature 2, if it stays blocked, remains in `ROADMAP.md` with the blocker restated.

## 4. Suggested order
1. Feature 1 (unblocked, low risk, high operator value) — ship end-to-end first.
2. Feature 2 only if a live VS Code host is available; otherwise research + leave working + re-log blocker.

## 5. Definition of done
Feature 1 fully shipped (all §1.8 boxes), VSIX repackaged, roadmap entry moved to DONE.md. Feature 2 either fully shipped (all §2.6 boxes, live-verified) OR explicitly left in its working pre-migration state with the blocker recorded — never partially rewired.

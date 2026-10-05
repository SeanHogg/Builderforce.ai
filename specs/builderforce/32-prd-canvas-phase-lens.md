# PRD 32 — Canvas phases: readiness, a lens on the surfaces, and a path instead of a blank

> **Status:** planned 2026-10-04. Not started. Execution is handed to a separate session. The
> planning session reviews the result against §9.
> **Design of record:** https://claude.ai/artifact/1f6FVnmAowDGCXCgQS9mbg. It has four artboards:
> (1) the interactive desktop canvas, (2) the phase map, (3) phone Measure-before-live and
> (4) the phone phase sheet. The sticky notes on that canvas name the seams.
> - The artboards win on pixels and this document wins on behaviour.
> - Where the mockup draws something this PRD rules out, this PRD wins. One example is agent
>   speech bubbles invented for a phase (see D7).
> **Governs:** `lib/canvasPhases.ts` and the five board surfaces it gates. It extends
> [PRD 28](./28-prd-canvas-one-composer-phone-chrome.md); never break PRD 28 §0's five invariants.
> **Roles (CLAUDE.md, HARD RULE):** the executing session codes on **Opus**. Every typecheck,
> guard and test run goes to a **Sonnet** subagent (§8). The planning model (Fable or Opus) does
> the review (§9). The planning session owns the version bump and the DONE/ROADMAP moves.

---

## 0. The problem, stated against the code

The method is IDEA → MAKE → RUN → MEASURE → REACH. Today the canvas treats the phase as a
**stored tab filter** and nothing more:

- `useCanvasSurfaceState.setPhase` (`components/creation-canvas/hooks/useCanvasSurfaceState.ts:108`)
  writes the choice to localStorage. Its only consequence is `surfacesForPhase()` narrowing the
  switcher, and the only surface it gates is `insights`, which appears at Measure.
- Nothing checks whether the phase is **possible**. Measure opens on a board that has no
  deployment and no metric. Reach does the same with nothing live.
- The Board (React Flow, `stage/CanvasBoardFlow.tsx`), the Room (R3F, `CanvasRoomSurface.tsx`),
  the command bar (`CanvasCommandBar.tsx`) and the starting points (`chrome/CanvasPromptStarter.tsx`)
  **do not react to the phase at all.**
- `PHASE_SURFACES.idea` offers `app` (`lib/canvasPhases.ts:82`). The file's own "additive"
  argument justifies keeping App *after* Make, not offering it *before*. In Idea, App can only
  open "Start this session's app", which invites building before the idea is tested.
- The phase key `builderforce:create:phase` is **global per browser**, not per canvas. Moving to
  Measure on canvas A puts canvas B in Measure too.

## 1. Outcome

A person picks a phase, and **the same surfaces read the session through that phase**:

1. **Readiness is derived from the board.** A phase is ready when the board holds what it
   needs. Nothing new is stored on the server.
2. **An unready phase still opens.** It shows the shortest path from what exists, with one press
   to have Brain do the next step. It is never a lock and never an empty surface.
3. **The Board** brings the phase's object kinds forward and dims the rest. A **ghost card**
   stands where the phase's first object would go.
4. **The Room** lights the station that belongs to the phase. New stations stand for evidence,
   build, ops and launch. An unready phase gets a sign that says what is missing.
5. **The command bar** tints the current phase's group. **The starting points** lead with the
   phase's starters.
6. **Surfaces are additive and honest:** App from Make onward, a new **Operate** from Run, Insights
   from Measure (now this canvas's metrics first), and a new **Launch** at Reach.

## 2. Decisions taken (the operator may reverse any of them before execution starts)

| # | Decision | Why |
|---|---|---|
| D1 | App leaves Idea. `PHASE_SURFACES.idea = ['chat','graph','ideas','room']`. | A prototype used to test demand is an `experiment` card on the board linked through `testedBy`, not the App surface. Operator asked "why would APP be applicable to Ideas?" (2026-10-04). |
| D2 | Readiness is a **pure function of the board's nodes**. There is no new column, table or API. | The signals already exist: `ideaLogEntries`, `sessionHasApp`, `deployment.url`, `boardMetricDefinitions`. One fact lives in one place (3NF). A stored readiness flag would drift from the board. |
| D3 | Requirements are cumulative: Make needs an idea. Run needs idea + app. Measure and Reach need idea + app + live. Reach also *recommends* a metric (a warning, not a gate). | Mirrors the arc. Reach without measurement is allowed, but the canvas should say it is spending blind. |
| D4 | An unready phase is **never locked**. Every surface still works, and the path card is collapsible. | `canvasPhases.ts` header: "never locks a person OUT of a capability". Same rule as the canvas's guest wall: never render a refusal. |
| D5 | The phase becomes **per canvas**: `builderforce:create:phase:<sessionId>`. With no stored choice, the default is the **frontier**, meaning the first phase that is not done. | A global key leaks state across canvases. Defaulting to Idea on a canvas that is already live is wrong. |
| D6 | The board lens is **on by default**, with a toggle in the ••• board menu called "Phase focus". The toggle is persisted per browser, like `canvasChrome`'s collapsed bar. | Someone arranging the whole board needs every card at full strength. Selected nodes always render at full opacity. |
| D7 | **No invented agent speech.** The mockup's room bubble stands for a REAL agent reply (`PeerSpeechBubble`) and is not built as phase copy. | Fabricated speech attributed to roster members is a lie on screen. Phase guidance comes from Brain and the path card. |
| D8 | Stations stay **data-driven** (`ROOM_STATION_SPECS`). The phase only **lights** one station and sorts it first in the room list. Remembered spots never move. | Matches roomStations.ts's open/closed rule. Moving stands a viewer placed would undo their work. |
| D9 | The ghost card is **not a node**. It is drawn with xyflow's `ViewportPortal` in flow coordinates. It is never added to `nodes`, never persisted and never synced. | A fake node would reach autosave, presence, undo and the minimap. |
| D10 | Operate and Launch are **compositions of existing panels**, not new editors. | `CanvasReleasesPanel`, `CanvasPublishPanel`, `SellInMarketplace`, `CanvasSocialPanel` and `chrome/CanvasMakeItReal.tsx` already exist. |

**Open questions for the operator.** Ask them before W10 and W11. If there is no answer,
build the default.

- **Q1.** Should Launch be a surface, or should the Make-it-real door stay the only entry?
  Default: surface (D10).
- **Q2.** Should Operate also list users/sign-ups, which needs usage events per deployment?
  Default: only what the board already holds (deployments, releases, app status). Users become
  a Gap Register entry.

## 3. Workstreams, in dependency order

Each workstream lists: files, contract, behaviour, i18n, theme/responsive, tests, **do-not**s
and acceptance criteria. Paths are relative to `Builderforce.ai/frontend/src/` and
`cc/` = `components/creation-canvas/`.

The size rule applies throughout. `cc/CreationCanvas.tsx` is 1171 lines and **must not grow by
more than ~10 lines in total across this PRD**. Wiring goes through one provider plus hooks and
the existing `CanvasSurfaceStage` props. Never add new state to the host.

### W0 — Correct `PHASE_SURFACES` (D1)

- **`lib/canvasPhases.ts`:**
  - Remove `'app'` from `idea`.
  - Rewrite the doc comment's "`chat`, `graph`, `room` and `app` are in EVERY phase" paragraph:
    App now starts at Make, for the reason in D1.
  - Keep the additive invariant: each phase's list is a superset of the one before.
- **`useCanvasSurfaceState.setPhase` already resets** to `graph` when the open surface leaves the
  set. Moving App → Idea now resets, which is correct.
- **Tests:** update `lib/canvasPhases.test.ts` and `cc/canvasSurfaces.test.tsx`. Assert that idea
  excludes `app`, that make…reach include it, and that every phase is a superset of the one before.
- **Acceptance:** in Idea the switcher shows Chat · Board · Ideas · Room. Pressing Idea while
  on App lands on Board.

### W1 — Readiness domain (D2, D3)

- **New `lib/canvasPhaseReadiness.ts`** (pure, no React, no I/O):

  ```ts
  import type { CanvasPhase } from './canvasPhases';
  export type PhaseRequirementId = 'idea' | 'app' | 'live' | 'metric';
  export interface ReadinessSignals { hasIdea: boolean; hasApp: boolean; isLive: boolean; hasMetric: boolean }
  export interface PhaseRequirement {
    id: PhaseRequirementId;
    /** The phase where this requirement is satisfied — where "Go to …" sends the reader. */
    satisfiedIn: CanvasPhase;
    met: boolean;
  }
  export interface CanvasPhaseReadiness {
    phase: CanvasPhase;
    ready: boolean;                       // every REQUIRED requirement met
    missing: readonly PhaseRequirement[]; // required and unmet, in arc order
    advisories: readonly PhaseRequirement[]; // recommended and unmet (Reach → metric)
    done: boolean;                        // this phase's OWN output exists (stepper ✓)
  }
  export function readinessSignals(nodes: readonly { id: string; data: Record<string, unknown> }[]): ReadinessSignals;
  export function phaseReadiness(phase: CanvasPhase, signals: ReadinessSignals): CanvasPhaseReadiness;
  export function readinessByPhase(signals: ReadinessSignals): Readonly<Record<CanvasPhase, CanvasPhaseReadiness>>;
  /** The first phase whose own output does not exist yet — the default phase (D5). */
  export function frontierPhase(signals: ReadinessSignals): CanvasPhase;
  ```

- **Requirements are DATA**, held in one table:

  ```ts
  const PHASE_REQUIREMENTS: Record<CanvasPhase, { required: PhaseRequirementId[]; recommended: PhaseRequirementId[] }> = {
    idea: { required: [], recommended: [] },
    make: { required: ['idea'], recommended: [] },
    run: { required: ['idea', 'app'], recommended: [] },
    measure: { required: ['idea', 'app', 'live'], recommended: [] },
    reach: { required: ['idea', 'app', 'live'], recommended: ['metric'] },
  };
  const SATISFIED_IN: Record<PhaseRequirementId, CanvasPhase> = { idea: 'idea', app: 'make', live: 'run', metric: 'measure' };
  // "done" (stepper ✓) = the phase's own output exists:
  const PHASE_OUTPUT: Record<CanvasPhase, PhaseRequirementId | null> = { idea: 'idea', make: 'app', run: 'live', measure: 'metric', reach: null };
  ```

  Reach's "done" depends on a published listing or post. It is `false` in v1; record it in the
  Gap Register only if the operator asks for a ✓ on Reach.

- **Signals.** Reuse the existing primitives and never re-derive them:
  - `hasIdea` = `ideaLogEntries(nodes).length > 0` (`lib/ideaLog.ts`).
  - `hasApp` = `sessionHasApp(nodes)` (`lib/canvasSessionApp.ts`).
  - `isLive` = some node has `data.kind === 'deployment'` and a non-empty string `data.url`.
    The field list is in `creationObjectRegistry.ts:490`. Put this predicate in
    `readinessSignals` and nowhere else.
  - `hasMetric` = `boardMetricDefinitions(nodes).length > 0` (`lib/canvas/boardMetrics.ts`).
- **New hook `cc/hooks/useCanvasPhaseReadiness.ts`.**
  - Inputs: `nodes`. Output: `{ signals, byPhase, frontier }`.
  - Memoise on a cheap **signature string** built from the kinds and fields the signals read, so
    a drag (position-only change) never recomputes. The work is O(n) and pure, with no network,
    so no `getOrSetCached` is needed. Say so in the file header (caching rule).
- **Tests:** new `lib/canvasPhaseReadiness.test.ts` with a table-driven case per phase × signal
  combination. It also covers:
  - a deployment with no url (not live);
  - an idea node in `parked` (still counts as an idea);
  - `frontierPhase` for each progression;
  - Reach as ready with the `metric` advisory.
- **Do not:** import React here; read localStorage; add a server endpoint.

### W2 — Per-canvas phase + frontier default (D5)

- **`lib/canvasPhases.ts`:**
  - `readChosenCanvasPhase(sessionId?)` and `writeCanvasPhase(phase, sessionId?)` key on
    `builderforce:create:phase:<sessionId>` when an id is given.
  - **Migration read:** if the per-session key is absent, ignore the legacy global key. Do not
    copy it, because it was never per-canvas truth. Delete the legacy key on first per-session
    write.
  - Every caller must pass the session id, including `useTaskRunner.ts` and
    `canvasSessionActions.ts`, which read the phase (grep `readChosenCanvasPhase` and
    `readCanvasPhase`). Remove the no-arg variants once nothing calls them (dead-code rule).
- **`useCanvasSurfaceState`:**
  - Takes `sessionId` and `frontier`.
  - The server snapshot stays `DEFAULT_CANVAS_PHASE`.
  - The client value is the stored choice, otherwise `frontier`.
- **Tests:** extend `canvasPhases.test.ts`:
  - per-session isolation (two ids, two phases);
  - the legacy key is ignored;
  - no stored choice gives the frontier.

### W3 — Stepper readiness (desktop + phone)

- **`cc/PhaseModalitySelector.tsx`** reads readiness from a new context (W4's provider), not
  from props. Each step:
  - `done` shows a ✓ glyph (inline stroke SVG);
  - `!ready` shows a lock glyph;
  - `aria-label` is `t('nav.stage.<id>') + ', ' + t('creationCanvas.phase.<state>')`, where the
    state is `ready`, `done` or `needs` (with `{phase}`).
  - Pressing an unready phase **still switches** (D4).
- **`cc/CanvasPhoneAppBar.tsx`:** the phase sheet rows get the same status line ("Ready" /
  "Now" / "Needs Run") plus the surfaces the phase adds, matching artboard 4.
- **CSS (`cc/CreationCanvas.module.css`):** `.phaseStep[data-ready='false']` uses `--canvas-muted`
  text. Glyphs inherit `currentColor`. No hex values.

### W4 — Phase context provider (the only host wiring)

- **New `cc/phase/CanvasPhaseContext.tsx`:**
  - `CanvasPhaseProvider({ phase, setPhase, readiness, focusEnabled, setFocusEnabled, children })`.
  - Hooks: `useCanvasPhase()`, `useCanvasPhaseReadiness()` and
    `useCanvasPhaseFocus(kind: string): 'in' | 'out' | null`. The last returns null when focus
    is disabled.
- **`CreationCanvas.tsx`:** wrap the existing tree once. Readiness comes from W1's hook and
  focus from W5's preference. This is the only addition (≤ ~8 lines).
- **Do not:** prop-drill `phase` into CreationNode, RoomStations or CanvasCommandBar. Each reads
  the context.

### W5 — Board lens (D6)

- **New `lib/canvasPhaseLens.ts`** holds the data `PHASE_FOCUS_KINDS: Record<CanvasPhase, readonly string[]>`:
  - idea: `idea`, `customerInterview`, `experiment`, `form`, `risk`, `targetMarket`, `persona`
  - make: `spec`, `website`, `prototype`, `code`, `flowStep`, `workflow`, `api`, `database`
  - run: `deployment`, `release`, `incident`, `ciRun`, `pullRequest`
  - measure: `kpi`, `dashboard`, `chart`, `metric`, `experiment`, `evaluation`
  - reach: `socialPost`, `emailCampaign`, `audience`, `pitch`, `brandKit`, `listing`

  The executor **validates every kind against `creationObjectRegistry.ts`**, drops any that
  don't exist, and adds any obvious missing ones per group. Every kind not in a phase's list is
  `out`. Frames are never dimmed.
- **`cc/CreationNode.tsx`:**
  - Add `data-phase-focus={useCanvasPhaseFocus(data.kind) ?? undefined}` to **both** roots: the
    `.node` article and the `.nodeOrb` article.
  - No other change.
- **CSS:**
  - `.node[data-phase-focus='out']:not(.selected), .nodeOrb[data-phase-focus='out']:not(.selected) { opacity: .42; transition: opacity .2s }`
  - `.node[data-phase-focus='in'] { box-shadow: 0 0 0 2px var(--canvas-phase-hue), var(--node-shadow) }`
  - `--canvas-phase-hue` is set on `.canvasShell[data-phase=<id>]` from `--stage-<id>`.
  - Check contrast of the ring in light and dark.
  - Honour `prefers-reduced-motion` by dropping the transition.
- **Edges:** where the host builds `edges` for `CanvasBoardFlow`, add
  `className: styles.edgeOut` when both endpoints are `out`. Locate that spot with grep
  (`useFramedBoard` or the board hook); do not compute it inside CreationNode. Rule:
  `.edgeOut path { opacity: .35 }`.
- **Toggle:**
  - `lib/canvasChrome.ts` gets `readCanvasPhaseFocus()` and `writeCanvasPhaseFocus()` (default
    true).
  - A row "Phase focus" in the ••• board menu, in the `.moreMenuTools` trough. It is not a
    floating pill (memory: canvas-bar-groups-are-captioned).
- **`data-phase` on `.canvasShell`:** the shell already publishes `data-view`. Add `data-phase`
  next to it.
- **Tests:** `cc/canvasPhaseLens.test.tsx`:
  - a node of an in-kind gets `data-phase-focus="in"`, an out-kind gets `out`;
  - toggle off gives no attribute;
  - a selected out-node has no dim class applied. Read back computed style only if the harness
    supports it; otherwise assert the attribute plus the class.
- **Acceptance:** in Measure on artboard 1's board, KPI and experiment cards carry the ring and
  everything else sits at ~0.4.

### W6 — Ghost card (D9)

- **New `cc/phase/PhaseGhostCard.tsx`**, rendered inside `CanvasBoardFlow`'s `<ReactFlow>`
  children through `ViewportPortal`.
  - It decides its own visibility: it returns null when focus is off, when any `in` node exists
    for the phase, or when `surfaceDef.showsBoard` is false.
  - **Position:** 80px to the right of the bounding box of existing nodes, top-aligned with it.
    With no nodes, it uses the current viewport centre. Compute this in a pure helper
    `ghostPosition(nodes, viewportCenter)` in `lib/canvasPhaseLens.ts`, which is tested.
  - **Content:**
    - When the phase is ready: kicker "Nothing here yet", title "Add the first {phase} object",
      a primary "Let Brain {verb}" button and a secondary "Add {kindLabel}" button.
      "Add" uses the host's existing `appendAtCenter`; reach it through context, not new props.
      If it is not reachable, use the same action the IDEA group's Add button uses.
    - When the phase is unready: kicker "Not yet · needs {phase}", title from
      `creationCanvas.phaseGate.<phase>.title`, and "Let Brain {verb of the first missing
      requirement}".
- **"Let Brain …"** submits a Brain prompt through the **same path the starting-point picker
  uses** (`chrome/CanvasPromptStarter.tsx` → its submit). No second send path. Prompts are data
  in W8's `PHASE_STARTERS` (`primary` entry per phase and per requirement).
- **Styles:** dashed `2px` border in `--canvas-phase-hue`, with the fill
  `color-mix(in srgb, var(--canvas-phase-hue) 7%, var(--canvas-panel))`. The card is 260px wide
  like `.node`, and its buttons use `--canvas-bar-control` height.
- **Tests:** `cc/phase/phaseGhostCard.test.tsx` checks the visibility matrix and that the
  position helper is right for an empty board and a populated one.

### W7 — Path card (D4)

- **New `cc/phase/CanvasPhasePath.tsx`.** It renders null when `readiness.ready` holds and there
  are no advisories.
  - **Desktop:** it sits directly under the fused phase/surface card in `chrome/CanvasTopChrome.tsx`,
    inside the same `topChromeSpaceRef` measurement, so `--canvas-top-chrome-space` grows and
    nothing overlaps.
  - **Phone:** it renders at the top of the surface area, below `CanvasSurfaceStrip`.
- **Content:**
  - kicker "{phase} · {n} step(s) away" and title `creationCanvas.phaseGate.<phase>.title`;
  - one line naming the missing requirement in plain words;
  - numbered steps, one per `missing` requirement. The first gets "Go to {satisfiedIn}", which
    calls `setPhase`, and "Let Brain {verb}" (W6's send path);
  - the Reach advisory renders as a warning-tone single line with "Go to Measure".
- **Collapse:** a chevron collapses the card to a one-line chip. The state is per session in
  memory only, never persisted, so a returning reader always sees what is missing.
- **a11y:** `role="status"`, buttons ≥ 44px tall on phone, focus-visible ring.
- **Tests:** `cc/phase/canvasPhasePath.test.tsx`:
  - null when ready;
  - step count = missing count;
  - "Go to" calls setPhase with `satisfiedIn`;
  - collapse/expand;
  - the advisory renders for Reach without a metric.

### W8 — Starting points + bar tint

- **New `lib/canvasPhaseStarters.ts`:**
  - `PHASE_STARTERS: Record<CanvasPhase, { key: string }[]>` with three per phase. Copy is in
    `creationCanvas.phaseStarters.<phase>.<key>` (label + prompt).
  - `REQUIREMENT_ACTIONS: Record<PhaseRequirementId, { verbKey; promptKey }>` holds the "Let
    Brain capture it / build it / deploy it / define it" prompts used by W6 and W7.
- **`chrome/CanvasPromptStarter.tsx` (and `PromptUseCasePicker` if it holds the list):**
  - The tab reads "Starting points · {phase}".
  - The list leads with the phase starters, then the existing catalogue filtered first by
    `cSuiteCanvasOwner(useCase)?.stages.includes(phase)`. That data already exists in
    `lib/templates/promptUseCases.ts`. Everything else follows unchanged.
- **`cc/CanvasCommandBar.tsx` / `CanvasBarGroup.tsx`:**
  - The group whose `stage === phase` gets `data-current="true"`, read from context.
  - CSS: `.barGroup[data-current='true'] .barGroupRow { background: color-mix(in srgb, var(--bar-stage-hue) 14%, var(--canvas-panel)); border-color: var(--bar-stage-hue) }`, and the caption gets weight 700.
  - No layout change. Never a pixel height (memory: canvas-bar-groups-are-captioned).
- **Tests:**
  - extend the starter test: starters lead, and filtered use cases come before unfiltered ones;
  - `canvasBarGroup.test.tsx`: `data-current` is on exactly one stage group.

### W9 — Room: phase-lit stations (D7, D8)

- **`lib/canvas/roomStations.ts`:**
  - Extend `RoomStationSpec` with an optional `phase?: CanvasPhase` (data).
  - `instances` gains an optional second arg `context?: { readiness?: Readonly<Record<CanvasPhase, CanvasPhaseReadiness>>; phase?: CanvasPhase }`.
    The existing specs ignore it.
- **New specs**, each an entry here and in `room-stations/registry.tsx`:
  - `evidence` (phase idea): stands when `ideaLogEntries(objects).length > 0`.
    Summary: "{n} ideas · {untested} untested". The panel reuses `IdeaStageBar` and the first 5
    `IdeaLogRow`s read-only, plus "Open Ideas" → `setSurface('ideas')`.
  - `build` (phase make): stands when `sessionHasApp`. Summary: the app's title and file count.
    The panel has "Open App".
  - `ops` (phase run): stands when any deployment object exists. Summary: "{env} · {version}" of
    the newest by `deployedAt`. The panel lists deployments (environment, version, url as an
    external link, deployedAt localized) and "Open Operate".
  - `launch` (phase reach): stands when `socialPost`, `emailCampaign` or `release` objects
    exist. Summary: counts. The panel has "Open Launch".
  - `metrics` (exists): add `phase: 'measure'`.
  - `phasePath` (no phase): stands **only** when `context.readiness[context.phase].ready` is
    false. Its face is a sign "Needs {first missing}" with the CanvasPhasePath content in the
    panel. This is the room's version of the path card.
- **Lighting.** In `room-stations/RoomStations.tsx`, the station whose spec `phase` equals the
  current phase gets `lit`:
  - an emissive rim / caption tint in the phase hue, from the `--stage-*` value read once via
    `getComputedStyle`, the way the room already resolves CSS colour for 3D, if it does
    (executor checks); otherwise from a small stage-hue map in the contract;
  - the first row in the room's station list (`RoomRoster`).
  - **Spots never move** (D8).
- **Station views** follow `room-stations/types.ts`: the hook returns null when the viewer is not
  entitled, faces use `face` (DOM via SurfacePanel, so **no React context reads inside the
  face**). Pass the counts in from the hook.
- **Tests:**
  - extend `lib/canvas/roomStations.test.ts`: each new spec's stand/no-stand matrix;
    `phasePath` appears only when unready; existing specs are unchanged with no context;
  - `cc/roomStations.test.tsx`: the lit station sorts first.

### W10 — Insights: this canvas first

- **`cc/CanvasInsightsSurface.tsx`:**
  - Before the Ask card and the global pins, a section "This canvas" renders
    `orderMetricReadings(boardMetricReadings(nodes))` with `summarizeMetricReadings`. Reuse
    `MetricsBoard`'s reading component if one is exported; otherwise extract it **from
    MetricsBoard into a shared component and migrate MetricsBoard to it** (DRY rule).
  - Empty state when there are no definitions: "No metric on this board yet", with "Let Brain
    define it" (W8 `REQUIREMENT_ACTIONS.metric`).
  - Global pins stay below, unchanged, with their existing heading.
- **Tests:** extend the insights surface test with three cases: the section with readings, the
  empty state, and pins unaffected.

### W11 — Operate surface (new; Run onward)

- **Registry:**
  - `lib/canvasSurfaces.ts` gains
    `{ id: 'operate', scope: 'board', order: 5, showsBoard: false, showsObjects: false, brainIsSurface: false, persist: true, composerIntents: ['ask'] }`.
  - Re-number the `order` values after it (insights 6, then the object surfaces +1). Only
    `order` sorts, so this is safe; check that no test pins the numbers.
  - `PHASE_SURFACES`: `run`, `measure` and `reach` add `operate` before `insights`.
- **New `cc/CanvasOperateSurface.tsx`** (presentational) with a hook `cc/hooks/useOperateReading.ts`
  (data from nodes). Sections:
  1. **Deployments:** the same list as the ops station panel. Extract one
     `DeploymentList` component and use it in both places.
  2. **Releases:** mount the existing `CanvasReleasesPanel`, after reading its props. If it
     needs host callbacks, pass them through `CanvasSurfaceStage` props the same way the other
     surfaces are passed. Never through new CreationCanvas state.
  3. **App:** status from `primarySessionApp(sessionApps(nodes))`, with "Open App".
  - **Empty state when not live:** "There's an app but nothing deployed", with "Let Brain
    deploy it".
- **`cc/stage/CanvasSurfaceStage.tsx`:** add `operate: <CanvasOperateSurface … />` to the map.
- **i18n:** `creationCanvas.surface.operate.{label,enter,active}` plus the
  `creationCanvas.operate.*` copy.
- **Tests:** `cc/canvasOperateSurface.test.tsx` covers live, not live, and no app. Extend
  `canvasSurfaces.test.tsx` for the registry entry, `persist`, and the phases it appears in.
- **Q2 default:** no users section. Add a Gap Register entry "Operate cannot show sign-ups:
  deployments carry no usage-event linkage" with that blocker.

### W12 — Launch surface (new; Reach) — only if Q1 = surface (the default)

- **Registry:** `{ id: 'launch', scope: 'board', order: 7, …, persist: true, composerIntents: ['ask'] }`.
  `PHASE_SURFACES.reach` adds `launch`.
- **New `cc/CanvasLaunchSurface.tsx`.** It is the Make-it-real door laid out as a place, with
  four sections in this order:
  1. **Prove it:** the realization verdict the door's "Prove it" row opens.
  2. **Publish:** `CanvasPublishPanel`.
  3. **Sell:** `SellInMarketplace`.
  4. **Tell people:** `CanvasSocialPanel`.

  Read each component's props first. Where one is a modal/panel body with host callbacks, pass
  them through `CanvasSurfaceStage` as in W11.
- **The door stays.** `chrome/CanvasMakeItReal.tsx` rows keep working. Add one row, "Open
  Launch", only if the operator wants it; default no, so the bar does not grow.
- **i18n:** `creationCanvas.surface.launch.*` and `creationCanvas.launch.*`.
- **Tests:** `cc/canvasLaunchSurface.test.tsx` checks that all four sections render and that
  each one's empty state works.

### W13 — Phone parity

- `CanvasSurfaceStrip` shows the new surfaces automatically through `surfacesForPhase`. Verify
  that `operate` and `launch` have icons in the strip's icon map (add stroke SVGs if it is keyed).
- The path card is placed as in W7. The ghost card is never shown on phone, because the phone
  board is too small; the path card covers it. Test this with a mocked `usePhoneViewport` (the
  PRD 28 gap: it is `false` in jsdom, so **mock it**).
- The phase sheet matches artboard 4 (W3).

### W14 — i18n (every workstream, same pass)

- **Every visible string** goes into all five catalogs (`frontend/src/i18n/messages/{en,zh,es,fr,de}.json`)
  with **real translations**. Namespaces:
  - `creationCanvas.phase.{ready,done,needs}`
  - `creationCanvas.phaseGate.<phase>.{title,body}`
  - `creationCanvas.phaseGhost.*`
  - `creationCanvas.phaseStarters.<phase>.<key>.{label,prompt}`
  - `creationCanvas.requirement.<id>.{label,verb,prompt}`
  - `creationCanvas.boardMenu.phaseFocus`
  - `creationCanvas.surface.{operate,launch}.*`
  - `creationCanvas.operate.*`, `creationCanvas.launch.*`
  - `creationCanvas.roomStation.{evidence,build,ops,launch,phasePath}.*`
- Phase names come from `nav.stage.<id>` and must never be retyped.
- Run the i18n parity guard (§8).

### W15 — Release note + marketing (Operate and Launch are new capabilities)

- One `release_notes` row, `category=new`, authored through the superadmin surface
  (`ReleaseNotesPanel` → `adminApi.createReleaseNote`). If the executing session cannot reach a
  live admin, ship a migration-seeded row the way earlier release notes did (grep `release_notes`
  migrations), and record the authoring step for the operator.
- **Blog post** `frontend/src/content/blog/the-canvas-knows-where-you-are.md`, modelled on
  `run-your-app-on-the-canvas.md`:
  - Open with the gap: "Measure opened on a board with nothing live."
  - Show it with `bf-figure` visuals (`kind: screen` for the path card, `compare` for the lens
    on and off, `flow` for the arc with readiness).
  - Include a "Where it sits in the method" section that walks Idea → Reach.
  - No changelog voice.

## 4. Theme, responsive, a11y (applies to every workstream)

- **Colours:**
  - Use only `--stage-*`, `--canvas-*` and `--bar-stage-hue` tokens; the canvas owns its palette
    (memory: canvas-owns-its-palette).
  - Any new token is declared in **both** the light `.canvasShell` block and the dark
    `:global(html:not([data-theme='light'])) .canvasShell` block of `CreationCanvas.module.css`.
  - No bare hex at a call site.
- **Checks:** confirm contrast in both themes for the ring, the dimmed nodes (titles must stay
  legible at 0.42 over `--canvas-board`; raise it to 0.5 if a title fails 3:1), the ghost card
  and the path card.
- **Layout:**
  - At ≤767px the path card is full-width, its buttons are 44px tall and they wrap.
  - Nothing overflows at 360px.
  - The ghost card is desktop-only (W13).
- **Interaction:**
  - Every new control is a real `<button>` with an accessible name.
  - The lock and ✓ glyphs are `aria-hidden`, with their state in the button's label.
  - Every transition is disabled under `prefers-reduced-motion`.

## 5. Architecture guardrails

- **Layers:**
  - `lib/*` modules are pure domain (no React, no fetch).
  - Hooks in `cc/hooks` adapt them.
  - Components render.
  - Nothing new talks to the API. Every input is already on the board.
- **No god components:**
  - `CreationCanvas.tsx` ≤ +10 lines in total.
  - `CanvasCommandBar.tsx` gets an attribute, not a branch.
  - New components are < 250 lines each and own their visibility (they return null).
- **Open/closed:** phases, requirements, focus kinds, starters and stations are **data tables**.
  A new phase or a new requirement is a table row, never a branch.
- **DRY:**
  - one deployment predicate (`readinessSignals`);
  - one deployment list (W11, used in two places);
  - one metric reading component (W10);
  - one Brain send path (W6).
- **Dead code:** remove the no-arg phase storage helpers (W2) and any helper made unused, after
  grepping frontend, api and the VS Code client (`clients/vscode`), because the VSIX compiles the
  same canvas source.

## 6. What this PRD deliberately does not do

- It adds no server-side readiness and no phase column on `creation_sessions`. Readiness is
  derived (D2).
- It invents no agent speech in the room (D7).
- It never hides a surface because a phase is unready (D4). Gating stays limited to which tabs
  a phase **offers**.
- It does not touch `useFounderJourney` (tenant-level, a different question; see the
  `canvasPhases.ts` header).

## 7. Order of execution and checkpoints

1. **W0 → W1 → W2 → W4** (foundation). **Checkpoint A:** Sonnet runs typecheck plus the tests
   for these.
2. **W3, W5, W6, W7, W8** (desktop experience). **Checkpoint B.**
3. **W9, W10** (room + insights). **Checkpoint C.**
4. **W11, W12** (new surfaces; ask Q1 and Q2 first if the operator is reachable). **Checkpoint D.**
5. **W13, W14 sweep, W15.** **Checkpoint E:** the full targeted list in §8, plus the guards.
6. Then hand the planning session the review packet (§9).

If a checkpoint fails, Opus fixes it and Sonnet re-runs **only** the failing list. Never run the
full vitest suite (memory: verify-runs-must-be-targeted).

## 8. Verification brief (for the Sonnet subagent, verbatim)

Run from `Builderforce.ai/frontend`:

1. `npm run type-check`. If the script name differs, use the one in `package.json`. Use tsgo/tsc
   as configured; never both.
2. `npm run check` (the guards: i18n catalog parity, `check:use-client-boundaries`, token/colour
   guards, EOL guards). Report every failure verbatim.
3. Targeted vitest, **only these files**:
   - `src/lib/canvasPhases.test.ts`
   - `src/lib/canvasPhaseReadiness.test.ts`
   - `src/components/creation-canvas/canvasSurfaces.test.tsx`
   - `src/components/creation-canvas/canvasPhaseLens.test.tsx`
   - `src/components/creation-canvas/phase/phaseGhostCard.test.tsx`
   - `src/components/creation-canvas/phase/canvasPhasePath.test.tsx`
   - `src/components/creation-canvas/canvasBarGroup.test.tsx`
   - the starter test that covers `CanvasPromptStarter` (find it with grep)
   - `src/lib/canvas/roomStations.test.ts`
   - `src/components/creation-canvas/roomStations.test.tsx`
   - the `CanvasInsightsSurface` test
   - `src/components/creation-canvas/canvasOperateSurface.test.tsx`
   - `src/components/creation-canvas/canvasLaunchSurface.test.tsx`
   - `src/lib/ideaLog.test.ts`, `src/lib/canvasSessionApp.test.ts`, `src/lib/canvas/boardMetrics.test.ts`
     (regression only)
4. VS Code client: `clients/vscode` type-check only, because it compiles the canvas source. Do
   not package unless the operator asks.
5. Report pass/fail per item with the failing output. **Do not judge design.**

## 9. Review checklist (planning session — Opus or Fable, never Sonnet)

The executing session hands over:

- the diff;
- the §8 report;
- screenshots or a short screen recording of Measure-before-live on Board, Room and phone, in
  both themes.

The reviewer checks:

- [ ] **D1–D10 obeyed.** In particular:
  - no fake node (D9): grep that the ghost card never calls `setNodes`;
  - no invented speech (D7);
  - no lock (D4): every surface still works in an unready phase.
- [ ] **One deployment predicate, one Brain send path, one metric reading component, one
  deployment list.** grep for a second `kind === 'deployment'` check outside `readinessSignals`
  and the registry.
- [ ] **`CreationCanvas.tsx` net change ≤ +10 lines; no new host state.** Phase is read through
  `CanvasPhaseContext` everywhere.
- [ ] **No file over ~400 lines created; no existing file pushed past it.**
- [ ] **Tables, not branches:** requirements, focus kinds, starters, stations. No
  `phase === 'measure'` in a component.
- [ ] **Per-canvas phase works**, and the legacy global key is gone from every reader (W2),
  including `useTaskRunner` and `canvasSessionActions`.
- [ ] **i18n:** all five catalogs carry real translations; phase names come from `nav.stage.*`.
- [ ] **Theme:** tokens declared in both theme blocks; dimmed titles legible; ring contrast in
  light and dark.
- [ ] **Phone:** path card above the surface, no ghost, 44px targets, the sheet shows readiness,
  and tests mock `usePhoneViewport`.
- [ ] **New surfaces:** registered as data; `persist` correct; offered only from Run (Operate) or
  Reach (Launch); existing panels composed, not cloned.
- [ ] **Release note + blog post** exist and sell what someone can now do.
- [ ] **ROADMAP / DONE hygiene:** the PRD 32 register entry moves to DONE.md with a dated ✅
  RESOLVED section. The Q2 sign-ups entry, if deferred, names its blocker.
- [ ] **Dead code:** the no-arg phase helpers are removed, and nothing they were the last caller
  of is left behind.

## 10. Definition of done

Each of the following holds on a real canvas, in both themes, on desktop and phone:

- On a board with an idea and an app but no deployment:
  - Measure opens on the Board with KPI and experiment kinds forward;
  - a dashed ghost card says it needs Run;
  - the path card offers "Go to Run" and "Let Brain deploy it";
  - the Room shows a "Needs a live app" sign station;
  - the bar's MEASURE group is tinted;
  - the starting points lead with Measure's starters.
- Adding a deployment object with a url makes Measure ready without a reload: the lock turns
  into a ✓ on Run, the path card disappears, and the ghost card asks for the first metric.
- Idea offers Chat · Board · Ideas · Room. Make adds App, Run adds Operate, Measure adds
  Insights (this canvas's metrics first) and Reach adds Launch.
- Two canvases keep independent phases.
- Every §8 item passes, and §9 is signed off.

# Code Visualizer: three questions, a clear review loop, and the VSIX agent drives the picture

Status: open. Design source: `.builderforce/design/code-visualizer.html` (built from `code-visualizer.src.html`, 2026-11-27).
Tracked by `AE-G057` in [GAP-REGISTER.md](../roadmap/GAP-REGISTER.md).

This compares the live visualizer with the design and lists every change it needs. Each item says what exists today
(with the file that does it), what has to change, and how to check it is done. Paths are relative to `Builderforce.ai/`.
`KGV` = `packages/knowledge-graph-view/src`, `AT` = `packages/agent-tools/src/knowledge`,
`RD` = `packages/run-delta/src/rules`, `MEM` = `builderforce-memory/packages/memory/src/knowledge`.

## What the design is

- **Three questions are the top-level navigation**, as numbered tabs under the header, each with its headline number:
  1. *What does it look like?* (size, change, dependencies, where it runs, journeys, data, states, owners, patterns, API, history, diagrams)
  2. *What can I clean up?* (maintainability score, ranked clean-ups, each shown before and after)
  3. *What fundamentals am I missing?* (22 fundamentals in four groups: reliability, security, delivery, operating)
- **Layout, left to right:** the first design's code pane (outline tree, file bar, source, "In plain words") · the picture with its toolbar · the answer column. The visualizer has no chat of its own.
- **The review is an explicit loop:** a first-run card, progress, "Review again" or "Update review · n files", a schedule, and past reviews with scores. Every answer says which review it came from.
- **The VSIX agent drives the picture.** The visualizer is opened from the VSIX, and the agent in the VSIX chat controls it. Asked "show me the ERD", the agent calls a tool with a *view spec* made of named pieces, and the visualizer draws it. A built-in view (the ERD) and a one-off view the agent composes use the same contract. While an agent view is on the picture, the answer column shows a "Shown by the agent in chat" card (title, one-line answer, pieces, Save as a view, Back to the question).

## What is reused as it is

These already exist and match the design. They need restyling only, not new behaviour.

| Piece | Where |
|---|---|
| 3D stage, semantic zoom, level rail | `KGV/stage/host/StageHost.tsx`, `LevelRail.tsx`, `stage/drill/useSemanticZoom.ts` |
| Code pane: tree, source, range highlight | `KGV/stage/overlay/CodePane.tsx`, `CodeDock.tsx`, `CodeLayer.tsx` |
| Map, Flow, Sequence, Graph, Mind map, Heat, List | `KGV/compute/tasks/placement/*`, `KGV/ListFallback.tsx` |
| Colour by (overlays) | `KGV/surface/overlays.ts`, `KGV/stage/host/ColourLegend.tsx` |
| Review handshake, progress chip, run history | `KGV/useReviewRun.ts`, `KGV/surface/ReviewAction.tsx`, `syncPill.ts`, `surface/run/*` |
| Incremental review (changed files only) | the plan's manifest diff, `KGV/types.ts:10-12` |
| Compare (restructure, baseline, snapshot, commit) | `KGV/surface/compareModel.ts`, `useCompare.ts` |
| Fix flow (apply on a branch, checks, undo) | `KGV/surface/fix/fixFlow.ts`, `clients/vscode/src/knowledge/knowledgeFixSession.ts` |
| ERD extraction (SQL, Prisma, Drizzle) | `KGV/surface/diagrams/schema.ts`, `useDiagramSchema.ts` |
| Diagram model drawn on the stage | `KGV/surface/diagrams/model.ts` (`Diagram`), `stage/host/diagramPlacement.ts` |
| Detectors (unused file/export/dependency, clones, copied directory, god module, cycle, layer skip, IO in loop, security risk, 16 patterns) | `AT/rules/*`, `MEM/rules/*`, `AT/codePatterns.ts` |

---

## 1. Shell and layout

**1.1 The three questions replace the question pills.**
- Today: 11 questions (`KGV/surface/questions.ts:52-106`, "Where does it go?" … "What do we know about it?") sit in the toolbar, with five behind More.
- Change:
  - Add `surface/questions3/` with a registry of three questions. Each question is `{ id, label, stat(graph) → string, rows: AnswerRow[] }`.
  - Each `AnswerRow` is `{ id, title, line(graph), show: ViewSpec, lens?, body: Component }`.
  - The 11 existing questions become rows:
    - `where`, `callers`, `layers` go to question 1;
    - `wrong`, `copied`, `unused` go to question 2;
    - `untested` goes to question 3 (Tests);
    - `patterns`, `changed`, `claims`, `knowledge` go to question 1.
  - Opening a row applies its `ViewSpec` (section 7).
  - Delete `questions.ts` and the question segment once nothing reads them.
- Done: the header row shows three numbered tabs with live stats; the old pills are gone; every old question is still reachable as a row.

**1.2 Three columns: code · picture · answer.**
- Today: code pane | picture inside the stage, a 340px right drawer with nine tabs (`KGV/surface/panels.ts:24`), and a `NodeSheet`.
- Change:
  - The right column becomes the **answer column**: the open question's rows, or one tool sheet (Simulate, Fix, Review, API) with a "Back to the answer" button.
  - Drawer tabs that the questions absorb are deleted:
    - Act → Q2 (the ranked clean-ups)
    - Coverage → Q3 › Tests
    - Patterns → Q1 › patterns
    - Domains → Q1 › owners/areas
  - Agent runs and Review stay as sheets.
- Breakpoints, replacing `layout.ts` and `onePaneStage`:
  - over 1200px: three columns;
  - 900–1200px: picture plus one side column, with a header switch Code | Answer;
  - 900px and below: one column, switch Code | Picture | Answer.
- Done: screenshots match the design at 1440, 1100 and 360px in dark and light.

**1.3 "In plain words" must say what the code does.**
- Today: `useStageWiring.tsx:342-344` builds it from the station card's meta line plus issues, which is not a summary.
- Change:
  - Add `say` to the graph: a one-sentence summary per file/symbol, written by the review's judge pass where it exists (`AT/reviewJudgePass.ts`), or else by a deterministic template ("Exports X, Y; called by A, B").
  - For a line, show the line's own sentence when one exists (the design's `SAY[file:line]`).
  - Store `say` as a node badge so it is never recomputed in the view.
- Done: selecting any file shows a sentence that names what it does, not its metrics.

**1.4 Toolbar: one row of views, 3D | Flat, and a height picker for City.**
- Today: `CameraBar.tsx`. The cameras are Map, System, Graph, Mind map, 3D, Heat, Style, Features, Flow, Sequence and List.
- Change:
  - The views are: City, Map, Matrix, Where it runs, Flow, Sequence, Layers, Graph, Mind map, Heat, List. The active one is labelled.
  - Add `Height: Lines | Parts | Changes` when the view is City in 3D (section 3.1).
  - Move "Colour by" into the legend as a segmented control (the design's legend). It is not in the toolbar.
- Done: the toolbar is one row at 1440px with 3D on.

## 2. The review loop (first run and every run after it)

**2.1 First run.**
- Today:
  - "No folder reviewed yet" plus `ReviewLauncher` (one "Review a folder" button) in `KGV/surface/SurfaceStates.tsx:50-107`.
  - VS Code shows "Ready to run" / "Run" (`labels/core.load.ts:41-44`).
  - The planner's tiles appear only after Run.
- Change:
  - Replace both with one **welcome card** over the dimmed app, containing:
    - the folder, its file and line count, whether git history was found, and an estimate (from `plan` without confirming);
    - what the review answers: the three questions, one line each;
    - option "Also read the last 90 days of git history";
    - option "Afterwards, keep it current: after every commit / every night / only when I ask" (2.4);
    - one primary button, **Review this project**;
    - one line: "Later reviews start from the Review button at the top right."
  - While it runs, the card shows the phases with counts (Find the files · Read and map every file n of N · Read history · Check 22 fundamentals · Look for clean-ups · Save the map) and Stop.
  - On finish the card goes away, question 1 opens, and a toast says "Review done".
  - **A project with earlier reviews can dismiss the card.** When the review store has a saved review for the folder (`reviewRunStore.ts`), the card also shows:
    - a close button (×) at its top right, and Escape closes it;
    - the line "Last reviewed {when} · {files} files · {n} files changed since" (changed files come from the same change detection the incremental re-review already uses) with an **Open the last review** link;
    - **Review again** as the primary button and **Use the last review** next to it.
    
    Closing opens the last saved review on question 1, with the changed files marked and the header offering "Update review · n files". A folder that was never reviewed has nothing to show behind the card, so it has no close button.
- Done:
  - a fresh folder shows the card with no close button, one click reviews it, and the three tabs then carry numbers;
  - a folder with a saved review shows the close button; closing it shows the last review's answers and "n files changed since {when}".

**2.2 Every later run: one button that says what it will do.**
- Today: the chip says "Reviewed {age} · in sync" / "out of date", and the footer holds "Start review / Review again". The two are in different places.
- Change:
  - The header holds a status chip and a button beside it:
    - chip "Reviewed 10:42", button **Review again**;
    - chip "2 files changed since 10:42", button **Update review** (primary);
    - while running, chip "Reviewing · 42%", button **Stop**.
  - The answer column's first line says "From the review at 10:42 · current", or "2 files changed since the review at 10:42 · Update".
  - The change count comes from the live watcher (`knowledgeLive.ts`) and from fixes applied in the view.
- Done: after editing two files the chip and the answer line both show "2 files changed", and Update re-reads only those.

**2.3 The Review sheet.**
- Today: Review/Runs tabs show outcome, duration, files read and files/s (`RunHistory.tsx:37-68`).
- Change: one sheet with:
  - the last review (what, files, how long), plus Update review · n files / Review every file;
  - "Changed since then", listing the files;
  - "Keep it current" (2.4);
  - "Past reviews", where each row adds **maintainability score and missing-fundamentals count** (2.5);
  - "What a review reads", listing code, history, coverage and host, each "read / not set up / not connected".
- Done: past reviews show the score trend.

**2.4 Schedule: after every commit, nightly, or manual.**
- Today: manual only, plus `backgroundIndexer.ts` (map-only, off by default).
- Change:
  - Add `builderforce.knowledge.keepCurrent: 'commit' | 'night' | 'ask'`.
  - `commit`: a git post-commit watcher (VS Code `git` extension API `onDidCommit`) queues an incremental review of the committed files.
  - `night`: a scheduled full review when the editor is open after 02:00 local, or on next open if it was missed.
  - The choice is made in the first-run card and the Review sheet.
- Done: a commit triggers an update within a minute, and it appears in Past reviews.

**2.5 A review record carries its results.**
- Today: run records (`review/reviewRunStore.ts`) hold timings only.
- Change: add `score` (maintainability, 3.x), `fundamentals: {missing, partly, inPlace, cannotTell}`, `cleanups: n` and `commit` (from `reviewCommit.ts`) to the record at completion.
- Done: the Review sheet and the question tabs read these numbers from the record and do not recompute them.

## 3. Views

**3.1 City is its own view, and the user picks what height means.**
- Today:
  - There is no City camera; `codeCity` routes to the tower.
  - Height is the size channel or complexity (`surface/transit/towerHeight.ts:16`), `18+16·log2(files)` at top level (`map.ts:62-66`), or methods×7 inside a drill.
  - There is no lines-of-code measure, and no per-node count of contained parts.
- Change:
  - Add a `city` placement in `compute/tasks/placement/city.ts`:
    - each area (directory/partition) is a district slab;
    - each file is a building whose **height = the chosen measure**, normalised to the tallest in view, with a floor of 0.4 units;
    - footprint = a fixed cell size by kind.
  - Add three measures to the review, stored as badges:
    - `loc`: non-blank lines;
    - `parts`: the number of components, classes and functions the node holds (count of symbol records, rolled up to directories);
    - `ch90`: commits touching the file in 90 days, which already exists as churn.
  - The toolbar's Height picker writes `height: 'loc' | 'parts' | 'changes'` into view state. The legend says "Height is lines of code" (or the other two).
  - Zooming into a district re-lays its buildings with the same measure.
- Done: City shows legacy/ as the tallest district with Lines and api/ as the busiest with Changes. Switching measure animates the heights.

**3.2 Matrix becomes a view.**
- Today: `PartitionMatrix.tsx` is a 2D table inside the Partitions lens panel.
- Change:
  - Add a `matrix` placement: parts on the diagonal, and a tile per dependency.
  - Tile colour: blue forward, amber backward, red for a loop.
  - Its data is `partitionMatrix` (`graphModel.ts:138`) at area level, and file imports inside an area.
- Done: Q1 › "How do the parts depend on each other?" opens it, and the api⇄jobs loop is red.

**3.3 "Where it runs" becomes a view.**
- Today: deploy units sit inside the System placement (`placement/system.ts:36-64`).
- Change: add a `deploy` placement with one platform slab per deploy unit (`deployFacts.ts`), the areas standing on the platform they deploy to, and bridges for calls that cross the network. Areas deployed nowhere stand off the slabs and are called out.
- Done: Q1 › "Where does it run?" opens it, and legacy/ is shown as deployed nowhere.

**3.4 ERD becomes a view the agent can open.**
- Today: the ERD only appears through the Diagrams dropdown (`DiagramPicker.tsx`), drawn from `schemaDiagram`.
- Change:
  - Make `erd` a view id that a `ViewSpec` can name (section 7).
  - Add TypeORM (`@Entity`, `@Column`, `@ManyToOne`) and SQL migration folders to `schema.ts`.
  - Selecting a table opens its `CREATE TABLE` in the code pane.
- Done: "show me the ERD" in the VSIX chat draws the tables and their relations, and clicking a table shows its source.

**3.5 Layers is a view name.**
- Change: rename the Style camera, or alias it, to **Layers**, which shows one plane per layer.

## 4. Question 1: What does it look like?

| Row | Data today | Change |
|---|---|---|
| How big is it? | files only (`Station.files`) | `loc` badge (3.1). A size bar by area. The three biggest files. Opens City. |
| What changes most? | churn badge | rank by `ch90`, plus the files that never changed. Opens City coloured by activity. |
| How do the parts depend on each other? | partitionMatrix | loops called out, with a link to the Q2 clean-up. Opens Matrix. |
| Where does it run? | deployFacts | platforms, plus what runs nowhere. Opens Where it runs. |
| What happens when someone asks for X? | flows/sequence | entry routes become the row list (one row per main route), with numbered steps. Opens Flow. Depends on `AE-G058` (entry points). |
| What data does it keep? | `schemaDiagram` | table count, and which code writes each table. Opens ERD. |
| What can an order become? (state machines) | none | **new detector**: an enum or union of string literals used in assignments and `switch` gives states and transitions. Opens a State view (placement `states`). |
| Who owns what? | CODEOWNERS badge | per-area owner, with unowned files listed. Colour by Owner. |
| What patterns does it use? | 16 pattern badges | pattern × area list. |
| What does the API promise? | routes badge, OpenAPI existence | routes with documented/tested flags. Opens the API sheet. |
| What happened lately? | last 20 commits | replay through the compare bar (exists). |
| Which diagrams can it draw? | 52-id catalog | the catalog list, with "from code / from history / needs X" per id. |

## 5. Question 2: What can I clean up?

**5.1 Maintainability score (0–100): new.**
- Today: none (`architectureStyle.ts` scores style fit; `ArchitectAnalysisService` asks a model; neither is wired in).
- Change:
  - `MEM/maintainability.ts` computes `100 − Σ points(finding)` over open findings.
  - Points per kind are a table:
    - unused directory 8;
    - god module 6;
    - copied directory 5;
    - area cycle 5;
    - layer skip 4;
    - unused export 1, capped at 6.
  - The score is deterministic and stored on the review record (2.5).
- Done: the Q2 tab shows "maintainability 53 / 100" and Past reviews show its trend.

**5.2 Ranked, sized clean-ups.**
- Today: findings are sorted by severity, then id. There is no effort or impact.
- Change:
  - Add `effort: 'small' | 'medium' | 'large'` and `impact: { linesRemoved?, dirsRemoved?, copiesRemoved?, loopsRemoved? }` to each code finding at creation (`AT/rules/*`).
  - Rank by points, then impact.
  - Each row: numbered pin, title in plain words ("Nothing uses legacy/"), a line ("Remove · −1,340 lines · −1 directory"), and on open the why, "Good looks like", effort, impact, provenance, and **See before and after** / **Do it on a branch** / **Prompt**.
  - Filter chips: All · Remove · Merge · Split · Untangle.
- Done: the list reads biggest win first, and each number matches the evidence.

**5.3 Detectors to add.**
- **Unused directory:** a roll-up of `code.unused-file`. It fires when every file in a directory is unused, nothing outside imports it, no test runs it, and it is not deployed. Evidence: lines, file count, and last change date.
- **Never called (call graph):** a symbol with no incoming `calls` edge, that is not exported from an entry and not a route/handler. It needs the symbol relations already loaded through `symbolsOf`. Evidence: file:line per symbol.
- **Area-level cycle:** a roll-up of file `cycle` edges to areas (api ⇄ jobs). Evidence: the import lines on both sides.
- **Silent catch in the project, not only per run:** reuse `scripts/lib/silentCatchRules.mjs` through one shared module that both the guard script and `AT/rules` import (DRY). Today the logic exists twice (the script and `RD/ilities/catchSwallowed.ts`); collapse it to one.

**5.4 Provenance is stored, not inferred.**
- Today: `findingProvenance` and `findingSource` guess from the kind (`surface/scope.ts:12`, `actModel.ts:21`).
- Change: add `provenance: 'deterministic' | 'heuristic' | 'model' | 'runtime'` to `Finding` in memory, set by each rule, and delete both guessers.

**5.5 Restructure proposals for every clean-up kind.**
- Today: `partition-violation` and `god-module` only (`compute/compare/restructure.ts:205`).
- Add proposers:
  - unused file/directory/export: drop the nodes;
  - copied directory: fold the copy into the original and rewire its importers;
  - area cycle: move the shared piece down a layer;
  - never called: drop the symbols.
- `AE-G056` (the god-module planner shared with its codemod) still applies.
- Done: every Q2 row has a working "See before and after".

**5.6 Codemods and dismiss.**
- Today: built-in codemods are unused-export and unused-file only; dismissing is missing.
- Change:
  - Build `unused-dependency` (remove it from the manifest and the lockfile) and `copied directory` (rewrite imports, then delete the copy) as host codemods.
  - Add **Not a problem**, which writes a suppression `{kind, anchor, reason}` to `.builderforce/knowledge/suppressions.json`. Rules skip suppressed anchors, and the row moves to a "Dismissed" filter.

## 6. Question 3: What fundamentals am I missing?

**6.1 The model.**
- Add `FUNDAMENTALS` (data, one row each) in `AT/fundamentals/registry.ts`: `{ id, group, label, goodLooksLike, scope: 'code' | 'project' | 'host', detector, provenance, fix? }`.
- A code-scoped fundamental yields per-file status and line-level gaps. A project-scoped one yields one status. A host-scoped one yields "cannot tell" until a connection answers it.
- Status values: in place, partly there, missing, cannot tell.
- The Q3 tab stat is "11 missing · 5 partly · 4 in place".

**6.2 Every finding carries lines.**
- Today: a memory `Finding` has "never a line number". code-shield's per-line findings lose their line in `AT/codeFileBadges.ts:42-49`. The VS Code host does not implement `evidence()`.
- Change:
  - Add `locations?: {path, startLine, endLine}[]` to `Finding` (memory model change; contract and regression test per the memory rules).
  - Keep the code-shield lines.
  - Implement `evidence()` in `hostKnowledgeGraphSource.ts` from `locations`.
  - The code pane marks flagged lines in the gutter, with an icon per fundamental, and clicking a gap opens file:line.

**6.3 Where each fundamental's answer comes from.**

"Promote" means move the run-delta rule's detection into one shared function that both the per-run rule and the project review call. No second copy.

| # | Fundamental | Today | Change |
|---|---|---|---|
| 1 | Logging | missing | **New.** For each entry point and job: does a logger call run on the path? Flag `console.*` in server code (code). |
| 2 | Error handling | run-delta only (`RD/ilities/catchSwallowed.ts`) | Promote to the project review. Add unguarded external calls (fetch/SMTP/db with no try or `.catch`) (code). |
| 3 | Tests | measured coverage plus static reach | Exists. Surface it as a fundamental, keeping the static-reach label "worked out, not measured", plus "Turn on measured coverage". |
| 4 | Input validation | run-delta taint (`RD/taintPath.ts`) | Promote: route inputs reaching a sink with no sanitizer (code). |
| 5 | Timeouts and retries | presence-only `deadline` badge | **New:** an external call with no timeout signal (code). |
| 6 | Health check | routes listed | **New:** is there a `/health`-style route (project). |
| 7 | Sign-in on every way in | run-delta guards plus entry facts (`AT/facts/jsEntryPoints.ts`) | Promote: entry points with no guard (code). |
| 8 | Permission checks | guard rank only | **New:** a handler reading by id with no ownership/tenant predicate (heuristic, code). |
| 9 | Secrets out of code | code-shield (lines dropped) | Keep the lines (6.2). |
| 10 | Safe dependencies | API OSV only (`osvScaScan.ts`) | Run an OSV lookup from the review (lockfile → querybatch), cached by lockfile hash (project). |
| 11 | Rate limiting | STRIDE coverage on new entries | Promote: middleware presence across routes (project). |
| 12 | Checks on every change | `hasCi` path regex | **New:** a workflow triggered on `pull_request` that runs test/typecheck (project). |
| 13 | Lint and types | fix-step script lookup | **New:** eslint/biome config plus tsconfig plus scripts present (project). |
| 14 | Lockfile | API `hasLockfile` | Move into the review (project). |
| 15 | Database migrations | app-detect `migrationsPath` | **New:** schema files present with no migrations folder/tool (project). |
| 16 | Settings per environment | run-delta env rules | **New:** hard-coded ports/hosts/URLs in server code (code). |
| 17 | README and docs | API `hasReadme` | **New:** the README has run and test sections (project, heuristic). |
| 18 | Metrics and tracing | missing | **New:** an otel/sentry/datadog/prometheus import (project). |
| 19 | Caching and slow paths | io-in-loop, god-module | Exists. Add line numbers (6.2) and unbounded queries (promote `RD/performance/unboundedQuery.ts`). |
| 20 | Alerts | missing | Host-scoped: answered by a PagerDuty/Sentry connection (`connectableCatalog.ts`), else "cannot tell · Connect your host". |
| 21 | Backups | missing | Host-scoped: no data source exists. Show "cannot tell" until a provider API is added (Neon PITR, D1 Time Travel). |
| 22 | Feature flags | missing | **New:** a flag SDK import or a flags module (project). |

**6.4 The picture for a fundamental.**
- Add one lens/overlay `fund:<id>` (one row in `lenses.ts`, and a `MetricId` in `overlays.ts`) that colours files in place / partly / missing / does not apply, and cages files with gaps.
- A project-scoped fundamental marks only the part where it lives. For example, Health check marks the router, and Migrations marks the database. It never paints every building.

**6.5 Fixes for fundamentals.**
- Today: the fix flow exists, but only two codemods.
- Change:
  - Each fundamental row may name a fix. Deterministic fixes get a codemod: add a `/health` route, read the port from env, swap `console` for the logger, report instead of swallow.
  - Everything else goes to the agent composer with a fixed prompt (exists).
  - Every fix resolves only when typecheck, tests, re-scan and agent review pass (exists).

## 7. The VSIX agent controls the visualizer, and can compose a view

The visualizer is launched from the VSIX and has no chat of its own. The agent in the VSIX chat is the only thing that
drives it besides the user's clicks: it opens the panel, shows a view, reads the reviewed graph, and saves views.

Today:
- No model-callable tool opens, drives or reads the visualizer.
- The only path is the pre-turn PreFetch row `/graph` (`agent-tools/src/prefetch/knowledgeRows.ts:83`) running `builderforce.openKnowledgeGraph {rootId, focus[]}`. Focus is its only parameter.
- `KnowledgeGraphViewProps` has no camera, diagram, selection, highlight or diagram-model input; the camera and diagram are internal `useState`.
- Chat messages render markdown only, with no inline diagram or "open in visualizer" on a model reply.

**7.1 One contract: `ViewSpec`.**
- Add `packages/knowledge-graph-view/src/viewSpec.ts`:
  ```ts
  type ViewSpec = {
    title: string;
    say?: string;                       // the answer in one or two sentences
    view: ViewId;                       // 'city' | 'map' | 'matrix' | 'deploy' | 'flow' | 'sequence' | 'erd' | 'states' | 'diagram' | …
    scope?: NodeRef;                    // where: an area, file or symbol (drill level follows)
    select?: NodeRef; line?: number;
    highlight?: NodeRef[]; dimOthers?: boolean;
    lens?: LensId; colourBy?: MetricId; height?: 'loc' | 'parts' | 'changes';
    compare?: { kind: 'restructure' | 'commit' | 'baseline'; id: string };
    diagram?: Diagram;                  // a composed view: nodes/edges/groups the assistant built (checkedDiagram limits)
    pieces: string[];                   // human-readable list of what it is made of, shown under the reply
  };
  ```
- Add `viewSpec?: ViewSpec` and `onViewSpecApplied?` to `KnowledgeGraphViewProps`. Lift the camera, diagram and selection out of internal state into one reducer that a spec can set.
- The three-question rows use the same `ViewSpec` (1.1), so a row, an agent's answer and a saved view are one thing.

**7.2 Model tools.** Register them in the VS Code Brain tool catalog (`clients/vscode/src/brain/brainToolCatalog.ts`); there is one name resolver, per the Brain pins rule.
- `visualizer.show(spec: ViewSpec)`: opens or reveals the Visualization panel and applies the spec. It returns what was drawn (node count, and what was missing).
- `visualizer.query({ nodes?, edges?, findings?, fundamentals?, where? })`: reads the reviewed graph (nodes, edges, findings, badges, schema tables). The model needs this to compose a correct spec. It never reads files.
- `visualizer.save(spec, name)`: stores a spec in `.builderforce/knowledge/views/<slug>.json`. Saved views are listed in Q1 › "Which diagrams can it draw?", and `visualizer.query` returns them so the agent can reopen one by name.
- The PreFetch `/graph` row becomes a thin caller of `visualizer.show` with `{ view: 'map', highlight: focus }`, so there is one path.

**7.3 Protocol.**
- Add a host→webview message `knowledge.view { spec }` (`clients/vscode/src/knowledge/knowledgeProtocol.ts`), handled without remounting. Today `KnowledgeView.tsx:38` remounts on focus with `key={focusKey}`; that must stop.
- Add webview→host `knowledge.viewApplied { title, drawn, missing }` so the tool can answer the model.

**7.4 Where the answer shows.**
- In the VSIX chat: a reply that called `visualizer.show` gets a card through `renderAfterMessage` (`brain-ui/src/BrainTimeline.tsx:91`, which already exists for run-delta cards). The card shows:
  - the title and the one-line answer;
  - "Shown in the picture";
  - the pieces as badges;
  - **Show it again**, **Save as a view**, **Copy as Mermaid** (`sequenceText.ts` / `pathMermaid` exist).
- In the visualizer: while the agent's spec is on the picture, the answer column opens with a "Shown by the agent in chat" card (title, one-line answer, pieces, **Save as a view**, **Back to the question**). Opening any question row ends the agent view.
- There is no chat box in the visualizer. Questions go to the one VSIX chat (ONE unified flow).

**7.5 Composed views.**
- When no built-in view answers the question, the agent builds a `Diagram` (nodes/edges/groups with `ref`s back to graph nodes) and sends it as `spec.diagram`. Example: "Which tables does the nightly job touch?" gives tables plus the job, with read/write edges.
- `placeDiagram` draws it on the same stage. Nodes with a `ref` stay clickable into the code pane.
- `checkedDiagram` keeps its limits (100 nodes, 600 edges). Lift its "imported nodes may not carry ref" rule for model-built diagrams whose refs exist in the graph.
- Done:
  - "Show me the ERD" typed in the VSIX chat opens the visualizer on the ERD;
  - "Which tables does the nightly job touch?" draws a composed view with clickable tables;
  - both can be saved and reopened from Q1.

## 8. Data model changes (one list, for review by an Opus agent)

| Change | Package | Why |
|---|---|---|
| `Finding.locations`, `Finding.provenance`, `Finding.effort`, `Finding.impact` | memory (`findingModel.ts`) | 5.2, 5.4, 6.2 |
| Node badges `loc`, `parts`, `say` | agent-tools review | 1.3, 3.1, 4 |
| Fundamental results per node plus per project | agent-tools (new `fundamentals/`) | 6 |
| Review record `score`, `fundamentals`, `cleanups`, `commit` | `reviewRunStore.ts` | 2.5 |
| Suppressions file | VS Code host | 5.6 |
| Saved views `.builderforce/knowledge/views/*.json` | VS Code host | 7.2 |
| `ViewSpec` and `viewSpec` prop, `knowledge.view` message | knowledge-graph-view, VS Code | 7 |

The memory changes ship with a contract snapshot and one regression test per change, in memory itself, and are released before the consumers are validated.

## 9. Order

1. **Contracts first:** `ViewSpec`, `Finding.locations/provenance`, review record fields (section 8). Opus review.
2. **Review loop** (2.1–2.5): it gates everything else, because every answer says which review it came from.
3. **Shell** (1.1–1.4) with the questions registry, then City (3.1), Matrix (3.2), Where it runs (3.3), ERD as a view (3.4).
4. **Q2:** score, ranking, the four new detectors, stored provenance, the proposers, dismiss.
5. **Q3:** the registry, then the promoted run-delta rules (one shared function each), then the new detectors, overlay and fixes.
6. **Agent control:** the tools, the protocol, the two cards (VSIX chat and answer column), then composed views.

Each step is checked against the design with harness screenshots at 1440, 1100 and 360px in dark and light, next to the matching design screenshot.

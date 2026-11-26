# One 3D stage, one code editor, for every surface

Status: design, revised after architecture review (2026-11-26). The seam was reshaped to match the real `MarkSet`/`MarkPaint`/`Placement` buffers, and the walk seam, package boundaries and editor read-mode decision were added. Gap entries: `AE-G059` (stage), `AE-G060` (editor), `AE-G061` (package time).

## Why

The user's direction, 2026-11-26:

- "The code editor and 3d renderer should be shared components that all surfaces can use (studio and canvas)."
- "When an application is being created in the starter or canvas or studio, the 3D view is how the components are visualized; even the agents should be visualized on the 3D view; the room on the canvas should be unified into the 3D."

Today there are two of each.

| Concern | Copies today |
|---|---|
| 3D | KG `stage/*` (instanced marks, rooms, halls, perspective rig, tweens, a11y proxies); `world3d/WorldViewport` + `Scene3D` (own `<Canvas>`, OrbitControls, rapier walk); `world3d/RoomScene` (seats, furniture, speech bubbles, OrbitControls); `model3d/Model3dViewport` (own `<Canvas>`, Grid, OrbitControls); `EvermindBrain3D`. That makes four WebGL contexts and three camera systems. |
| Code | Monaco `CodeEditor.tsx` (edit + Yjs) and `FileChangeViewer.tsx` (diff); the KG `drill/CodeLayer` + `useCodeDiff`/`codeDiff.ts` (a custom DOM reader and diff) inside `CodeDock`. |

Both 3D copies use the same versions (`three ^0.185.1`, fiber `^9.7.0`, drei `^10.7.8`), so no version reconciliation is needed. Nothing draws an `AppBlueprint` today. Agents are drawn only as generic Room seats.

## End state

### Package `@builderforce/stage3d` (extracted from `knowledge-graph-view/src/stage`)

ONE R3F `<Canvas>` per surface. The stage knows nothing about code, rooms or agents. It draws **layers** fed by **content sources**.

The real seam today (`stage/types.ts`, `Stage.tsx`) is **three generation-gated, slot-indexed, worker-built buffers**: `MarkSet` (built once per graph, `capacity` preallocated), `MarkPaint` (tone/flags per slot) and `Placement` (position/scale/extrude per slot **plus** `links`, `planes`, `labels`, `captions`, `a11y` and the `CameraRig`). Links and planes belong to a placement, not to the marks. The design keeps that seam and composes **at the buffer level**; it does not invent a parallel `LinkSet`/`PlaneSet`.

```ts
interface StageSource {            // one content source, pure data → buffers for ITS slot range
  id: 'code' | 'bp' | 'agent' | 'room' | string;   // key namespace: every key it emits is `${id}:${localKey}`
  marks: MarkSet;                  // its own generation; `type` indexes the stage's FORM table, not KG's MARK_TYPE_ORDER
  paint: MarkPaint | null;
  place(ctx: PlaceCtx): SourcePlacement | null;   // positions for its own slots + its links/planes/labels/captions/a11y
  anchorTo?: string;               // another source's id: placed AFTER it, may read its resolved positions (agents → bp/code)
  reserve?: number;                // slot headroom: join/leave = scale 0 ↔ 1 in placement, never a MarkSet rebuild
  decor?: ReactNode;               // see the decor rules below
}
interface StageProps {
  sources: StageSource[];          // composeSources() → ONE MarkSet/MarkPaint/Placement (slot ranges, composite generation)
  camera: CameraMode;              // 'orbit' | 'ground' | 'flat' | 'walk'
  walker?: WalkerPort;             // only read while camera === 'walk'
  selected: string | null; onSelect(key: string): void;   // key is namespaced; the host routes by prefix
  colors, reducedMotion, nav, description, onDrill, onOut, onClear, onContextLost   // today's props, unchanged
}
```

**Composition rules.**

- `composeSources` concatenates slot ranges. The composite generation is the tuple of source generations (a digest). A change in one source rebuilds only when that source's `MarkSet` generation changes. Paint and placement are re-sliced, and the generation gate stays exactly as today.
- **Keys are namespaced** (`code:`, `bp:`, `agent:`, `room:`). Picking stays ONE CPU pick grid over the composite placement (`pickGrid.ts`, `StageInteraction`). `onSelect`/`onDrill` hand the namespaced key back, and the host dispatches to the owning source by prefix. No source does its own raycast.
- **Placement is two-pass.** Base sources (`code`, `bp`, `room`) place into their own region, and the composer offsets each region so they do not overlap. `PlaceCtx` carries the region origin. Anchored sources (`agent`) place second, reading `ctx.positionOf(key)` of the resolved base. The rig `home` and `fit` come from the composite bounds.
- **Instanced marks carry seats, agents and services.** Each one is a body with a form, a tone and a key. That needs ONE new form, `figure` (a capsule), added to `FORM_CODE`, the shader and `FORM_RISE`. Agents and seats use `reserve` headroom, so a run starting or ending is a placement change (a tween), not a mesh rebuild. Agent "thinking" or last-step text is a `LabelRun` with `chip`, not a DOM island.
- **`decor` is NOT a god-slot.** It is the ONLY non-instanced path and is bounded:
  - Decoration only. It is never pickable: anything selectable is a mark, and decor follows it.
  - No cameras, controls, `<Canvas>`, lights or `useThree().set`.
  - It positions itself from `useMarkPosition(key)` (it follows tweens) or from fixed world coordinates in its source's region.
  - It calls `invalidate()` when it animates (the canvas is `frameloop="demand"`).
  - A guard (grep in `check-stage-decor`, phase 3) fails on `OrbitControls`, `<Canvas`, `PerspectiveCamera` or `onClick`/`onPointer*` inside a decor module.
- **Drill handoff** (bp → code): `onDrill('bp:<serviceId>')` makes the host swap the `bp` source for a `code` source scoped to `service.rootDir`. This is a source swap on the same stage, not a second view.
- The rig, tweens, lighting, forms, pick grid, chips, captions and a11y proxies move into the package. **It is not a pure `git mv`.** Today `stage/` imports KG modules: `../../shapes` (MarkType, MARK_TYPE_ORDER, TYPE_SHAPE), `../../scene/themeColors`, `../../surface/ui/type`, `../../surface/transit/cardPlacement`, `../../labels`, `../../compute/*`, and `CallSite` from `@seanhogg/builderforce-memory/knowledge` (`types.ts`, `LinkBatch.callSites`). Those edges are cut first (see Package boundaries).
- **Stays in KG:** `stage/host/*` (StageHost, ColourLegend, LevelRail, StagePins, stageFactory), `stage/drill/*` (semantic zoom, nest, unfold, useStageMap, CodeLayer, codeDiff, useCodeDiff, lensActions) and the `compute/tasks` workers. Together they are `codeContent`.

**Walk seam (concrete).** Today `StageScene`'s `useFrame` calls `rig.tick`, then `aimCamera(rig.pose(), …)`, then `set({ camera })` on every frame. `PlayerController` independently mutates `useThree(s => s.camera)` in its own `useFrame`. The two would fight, and the stage would win, because it re-aims every frame and may swap in the orthographic camera.

1. `RigController` gains a **pose source**: `rig.drive(walker)` / `rig.release()`. While driven, `rig.tick` calls `walker.step(t, dt)`, which returns `{ position, target, up, fov, moving }`. `rig.pose()` returns that pose, and `aimCamera` always picks the perspective camera. On release, the rig tweens from the walker's last pose back to the placement's orbit home.
2. `PlayerController` is refactored into a `WalkerPort` implementation. It stops reading or writing the R3F camera, owns the rapier body and look yaw/pitch, and exposes `step()`. It reads the body translation after the `<Physics>` step and sets velocity for the next one. There is no second camera writer and no `useFrame` priority games: a positive priority would disable R3F's auto-render.
3. `frameloop` stays `demand`. `walker.step().moving || walker.active` counts as `rigMoving`, so the stage invalidates every frame while walking.
4. `<Physics>` mounts inside the stage Canvas only in walk mode, from `@builderforce/stage3d/walk` (a lazy subpath, with `@react-three/rapier` as an **optional peer**). Colliders are generated from the composite `planes` (room slabs → cuboid floors) plus colliders that a source's `decor` declares (furniture).
5. Input: while walking, `bindOrbitKeys`, the gesture handlers and `StageInteraction` picking are unbound. The walker owns pointer lock, WASD and the touch pad (`WalkerTouchControls`). Esc releases.
6. Lighting: the stage keeps its own `lighting.ts`. `CanvasWorldLighting` (world.ts) maps onto it. Shadows are on only in walk mode, because a `shadows` canvas costs every surface.

### Content sources (one module each, each pure data → `StageContent`)

| Source | From | Draws |
|---|---|---|
| `codeContent` | `KnowledgeGraph` | Today's marks, rooms and halls. |
| `blueprintContent` | `AppBlueprint` (`packages/creation-canvas-contract`) plus a `ServiceStatus` map | Each `AppService` is a room. The database, bindings, secrets and domains are marks in or beside their room. Bindings are halls. `AppBlueprint` has **no status field**, so the status tone (planned, building or running) comes from a separate `Record<serviceId, ServiceStatus>` fed by the run loop and the build pipeline. It is not added to the blueprint, which is a stored spec. |
| `agentContent` | `AgentPresence[]` (new type in `creation-canvas-contract`: `runId, agentId, label, path?, state, lastStep?`), produced by an adapter in each host (VS Code run store; frontend `run.tool` frames) | One `figure` mark per running agent, anchored (`anchorTo`) to the mark it is editing. The file path maps to a service by the longest `AppService.rootDir` prefix, or to the `code:` mark of that file when code is shown. It has a chip label and tweens as the agent changes files. |
| `roomContent` | `CanvasRoomDesign`, `RoomGeometry`/`RoomSeatSpot`, peers | Seats and people are `figure` marks (pickable). Furniture GLBs, avatar faces and speech bubbles are `decor` that follows the seat mark. |
| `model3dContent` / `brainContent` | `Model3dState` / Evermind signals | Each places ONE anchor mark per entity (pickable, selectable) plus `decor` meshes. The `Model3dViewport` `Grid` becomes a `PlaneSpec` (`kind: 'band'`). |

**App creation** (starter, canvas, Studio) composes `[blueprintContent, agentContent]`. A service appears as it is planned, fills in as it is built, and the agents working on it stand in it. Drilling into a service hands off to `codeContent` for its files: the same stage with a semantic zoom.

The **canvas Room** composes `[roomContent, agentContent]`, plus `blueprintContent` when the space has an app. People and agents share the stage with the app. RoomScene, WorldViewport, Scene3D and Model3dViewport stop owning a Canvas and become content.

### Package `@builderforce/code-editor`

ONE `CodeSurface` component and ONE API, with **two backends chosen by mode**:

```ts
type CodeSurfaceProps =
  | { mode: 'edit'; path; text; onChange; ydoc?; modelNamespace?; labels }     // Monaco (lazy)
  | { mode: 'diff'; path; before; after; labels }                               // Monaco DiffEditor (lazy)
  | { mode: 'read'; path; text; marks?: LineMark[]; reading?: number; onLine?; lenses?: LineLens[]; rails?; labels };  // light reader
```

**Decision: read mode keeps the light virtualized reader. It is NOT Monaco.** The reasons:

- The VS Code webview does not bundle Monaco today (it is a frontend-only dependency). Adding it would add MBs of code, its workers (CSP `worker-src blob:`) and its CSS to a panel that sits beside VS Code's own editor.
- The KG reader is a fixed-row virtualized list with inline one-row lens rows, symbol rails and drill. Every row index maps to a line. Monaco view zones and code lenses would re-implement that against an API that was not built for it.
- The read path renders on every drill step. It must stay instant and theme-token coloured.

So:

- `CodeLayer`'s generic part moves into `code-editor` as the `read` backend: rows, `useVirtualRows`, `syntaxLight`, rails and lens rows.
- The KG specifics stay in KG and enter through props: `lensActions`, `SymbolRecord` → `LineMark`, `codeText`, and the compare data from `useCodeDiff`/`codeDiff.ts`, which is a read-mode overlay of moved spans across revisions, not a two-pane diff.
- `CodeEditor.tsx` and `FileChangeViewer.tsx` today each own a `dynamic(import('@monaco-editor/react'))` loader. They collapse into the package's one lazy Monaco loader.
- The package uses `React.lazy` and a `labels` prop, never `next/dynamic` or `next-intl`. Those stay in the frontend wrapper.
- Monaco is an **optional peer**, so the webview can mount `read` mode without it.
- "Delete the old copies" means: the two Monaco wrappers, and `CodeLayer`'s row and rail rendering (moved, not deleted). `codeDiff.ts`/`useCodeDiff` stay in KG as a data feed.

## Package boundaries and dependency direction

All of these are source-only (`exports` → `src/`) and are registered in `scripts/lib/sourcePackages.mjs`. Each also gets hand-written `paths` in every consuming tsconfig: frontend, `clients/vscode`, the webview and the KG harness. `check-source-package-graph.mjs` rules 1–5 and 9 must pass.

```
creation-canvas-contract  (types only; + AgentPresence, ServiceStatus)
          ▲                         ▲
stage3d  ◄── stage3d-sources ───────┘        code-editor
  ▲  ▲            ▲   (blueprintContent, agentContent: pure data → StageSource)   ▲
  │  └── knowledge-graph-view (codeContent, host, drill) ─────────────────────────┘
  │                 ▲
frontend (roomContent, model3dContent, brainContent + decor; Next wrappers)   VS Code webview
```

- **`stage3d` imports NO domain package.** It does not import `@seanhogg/builderforce-memory/*`, `knowledge-graph-view`, `creation-canvas-contract` or `code-editor`. To get there:
  - `LinkBatch.callSites` becomes a generic `pickData?: unknown[]`. KG narrows it back to `CallSite`.
  - `MarkSet.type` indexes the stage's own `MarkForm` table. KG's `TYPE_FORM`/`MARK_TYPE_ORDER` mapping stays in KG and is applied when KG builds its MarkSet.
  - `themeColors`, `TYPE` (fonts) and `cardPlacement` move into `stage3d` (KG re-imports them), or are injected as props.
  - **Guard:** a rule in `check-source-package-graph.mjs` (or a sibling check) fails on any of those specifiers under `packages/stage3d/src`. This keeps the stage generic and stops rule 9 (npm subpaths) from pulling memory into every stage consumer.
- **`stage3d-sources`** (blueprint and agent sources) is separate, because both the VS Code visualizer and the frontend mount it. It must not live in the frontend. `roomContent` and `model3dContent` need frontend meshes, i18n and the room design store, so they stay in `frontend/src/components/creation-canvas/stage/`.
- **Peers.**
  - `stage3d`: three, fiber, troika and react are peers. `drei` is dropped, because the stage already avoids it (B3). `@react-three/rapier` is an **optional** peer, used only by the `./walk` subpath.
  - `code-editor`: `@monaco-editor/react`, `monaco-editor` and `y-monaco` are optional peers.
- **Webview (vite).**
  - The `KNOWLEDGE_VIEW_PEERS` resolver in `clients/vscode/webview/vite.config.ts` is keyed to KG's peers. It becomes a peers resolver derived from `sourcePackages.mjs` that covers every source package (the guard's rule 7: no hand-named strings).
  - If walk is ever offered in the webview, rapier's WASM meets `dropWasmAssets`, the `SHIPPED_WASM` allow-list and the webview CSP (`wasm-unsafe-eval`). Until then, walk is frontend-only and the webview never imports `stage3d/walk`.
- **Next.** The frontend aliases the new packages the same way it aliases `knowledge-graph-view` today. The stage is still loaded with `dynamic(..., { ssr: false })` from the frontend wrapper.

## Phases (each ships and is reviewed on its own; Opus review: cross-package)

0. **Package time** (`AE-G061`). This is independent and can run now.
1. **Cut the stage's KG edges in place** (still inside `knowledge-graph-view`):
   - make types generic (`pickData`, the form index);
   - move `themeColors`/`TYPE`/`cardPlacement` under `stage/`;
   - add the "no domain import" grep scoped to `src/stage` minus `host/` and `drill/`.
   
   Done-check: the KG tests run **unchanged**, and the webview builds and renders in the real webview.
2. **Extract `stage3d`** (`git mv` of the now-clean files and their tests) and add `composeSources` with KG as the only source:
   - register the package in `sourcePackages.mjs`, every tsconfig `paths` and the webview peers resolver;
   - move the stage's tests with it and run them from the package's own vitest config.
   
   Done-checks: `check-source-package-graph` is green; the KG tests (`Stage.*`, `renderer.*`, `rig/*`, `StageHost.*`) pass unchanged; the visualizer harness renders.
3. **`code-editor`**: move the read backend out of `CodeLayer` and give the two Monaco wrappers one loader.

   Done-checks:
   - `CodeLayer.test`, `CodeLayer.lens.test` and `useCodeDiff.test` run unchanged against the moved reader;
   - the CodeEditor and FileChangeViewer tests run unchanged;
   - the webview bundle contains no `monaco-editor` chunk.
4. **Canvas onto the stage**:
   - add the `figure` form;
   - build `roomContent`, `model3dContent` and `brainContent` with `decor`;
   - add `rig.drive`/`WalkerPort` and refactor `PlayerController`;
   - add the decor guard;
   - delete `WorldViewport`'s, `Scene3D`'s, `RoomScene`'s and `Model3dViewport`'s `<Canvas>` and every `OrbitControls`.
   
   Done-checks:
   - a grep shows exactly ONE `<Canvas` per surface (the stage's);
   - there is no `OrbitControls` import under `frontend/src`;
   - the `PeerSpeechBubble` and room tests run unchanged;
   - walk → exit → orbit returns to home without a camera snap (a rig test);
   - picking a seat, a peer and a model entity returns `room:`/`model:` keys.
5. **App creation and agents**:
   - build `stage3d-sources` (`blueprintContent`, `agentContent`), `AgentPresence`/`ServiceStatus` and one adapter per host;
   - mount the sources in the starter, canvas, Studio and the VS Code visualizer.
   
   Done-checks:
   - an agent start or stop changes the placement only (the MarkSet generation is unchanged);
   - a file path maps to its service by the longest `rootDir` prefix (unit test);
   - drilling `bp:` → `code:` keeps one Canvas.

**What breaks first:** phase 2's aliasing. A source package missing from one toolchain has broken builds twice before. It is followed by phase 4's walk input fights: pointer lock against `StageInteraction`, and the demand frameloop. Both are the reason for the dedicated done-checks above.

## Decisions (defaults taken 2026-11-26; the user can overturn them)

- **Walk in the VS Code webview: no.** Walk stays a frontend-only capability, which keeps rapier WASM and its CSP out of the extension.
- **The Room shows the app's blueprint by default** when the space has one, following the user's words: "the 3D view is how the components are visualized". The composite bounds and the home camera frame both the room and the blueprint.

## Not doing

- No adapter that wraps the old scenes.
- No second Canvas "just for the Room".
- No per-surface copy of the rig.

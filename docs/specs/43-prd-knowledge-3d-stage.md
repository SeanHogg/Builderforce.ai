# PRD 43 — One 3D stage for every knowledge camera

Status: design, revised after Opus review (2026-11-08, approved with changes). Owner: the knowledge-graph view (`packages/knowledge-graph-view`).

## Why

On the `agentic` workspace (2000 of 3138 nodes drawn, 104,972 of 158,663 edges drawn, 20,738 findings, 389 stations), every graph camera blocks the screen for 1.5–4.5 s. The cameras are Graph, Map, Transit, Tower, 3D and Sequence, built on five rendering stacks:

- SVG for Graph 2D, the mind map, the transit map, Tower (2.5D SVG) and Sequence;
- R3F for the 3D scene.

Only the 3D scene has depth. The operator wants every one of these cameras fast and able to show depth. Future work will edit code from the visualizer, so the renderer must take slot patches rather than rebuilding everything.

The `src/perf` harness (run with `KG_PERF=1`) measured these steps on a synthetic graph with the same statistics:

| Step | Median ms | Note |
|---|---|---|
| `insightsOf` | 1477 | runs for every camera |
| `rankTask` | 1460 | one idle step is a 1069 ms sort |
| `pathOfStations` | 1272 | scans 150k edges per hop |
| `layout2dTask` / `layoutTask` | 1122 / 1083 | longest single step 730 / 394 |
| `canonicalEdges` | ≈455 | computed 3× |
| `buildLines` + `buildStations` + outline decode | ≈1370 | synchronous in `useSurface`, so every camera pays it |
| Rendered, longest stall | 4415 / 1686 / 1599 / 266 | Graph 2D / Transit / Tower / Map |

## Part A — computation off the main thread (in flight; prerequisite)

- **A1.** Fix the pure algorithms with outputs unchanged.
- **A2.** Build ONE graph compute worker (`src/compute/`):
  - the graph is loaded once and stays resident in the worker;
  - typed tasks run there, and results come back as **indices**, so object identity holds;
  - when no worker is available, the same tasks run in-process.
- **A3.** Coalesce wheel zoom so it causes no React commit per tick.

Done when no main-thread task in the harness exceeds 50 ms. Part B adds its tasks to this worker; it never adds a second one. The one exception is troika's own SDF worker, which is internal to the text library.

**Still open from A:** structured-cloning the graph into the worker, and the JSON parse in `useKnowledgeGraph`, are synchronous on the main thread. Measure both on the harness graph. If either exceeds 50 ms, send bytes (the knowledge pack form) instead of objects.

## Part B — the stage

### B1. The contract

A graph camera stops rendering its own scene. It supplies:

1. **A spec builder.** A pure function `(graph, SpecInput) → SceneSpec` that runs in the compute worker.
2. **A `CameraRig`.**
3. **Optionally, a DOM overlay** of cards and panels, plus captions in the UI font (see B3, Labels).

**Rule: no host-supplied functions cross into a spec builder.** `SpecInput` is serializable. Today's closures move into pure registries that the worker imports:

- `SurfaceModel.overlay.style()` / `lineWidth()`, which become overlay bindings as data;
- `LensDef.nodeStyle`, which becomes the lens registry looked up by lens id;
- the transit `noteOf`, which becomes the question registry looked up by question id.

```ts
interface SpecInput {
    camera: ViewMode; lensId: string; questionId: string | null; family: string | null;
    overlay: OverlayBindings;            // data, not functions
    lit: string[] | null; pins: Pin[]; selected: string | null; lineId: string | null;
    drill: DrillLevel | null; unfolded: string | null; roles: [ref: string, role: TowerRole][] | null;
    viewport: { width: number; height: number; dpr: number };
    lod: number;                          // the current level-of-detail band, set when zoom settles
    strings: Record<string, string>;      // the catalog strings the spec embeds (already localized)
}

interface SceneSpec {
    generation: number;
    keys: string[];                       // stable key per slot (node ref, station id, line id, pin id)
    marks: MarkBatch[];                   // ONE batch per shape
    links: LinkBatch[];                   // ONE batch per style family (all per-segment attributes)
    planes: PlaneSpec[];                  // bands, partition planes, lifeline planes (alternating tone per plane)
    labels: LabelRun[];                   // SDF (mono names); UI captions go to `captions`
    captions: Caption[];                  // localized UI-font text drawn in the DOM caption layer
    a11y: A11yItem[];                     // Tab stops, label, pressed/current state, the view description
    pick: PickGrid;                       // typed-array spatial grid over projected boxes (see B5)
    caption: { shown: number; total: number; capped: boolean };  // "Showing N of M", as EdgesCapped does today
    bounds: { min: Vec3; max: Vec3 };
}

interface MarkBatch {
    shape: 'disc' | 'square' | 'towerSprite' | 'tower' | 'sphere' | 'pin' | 'satellite'
         | 'terminusTank' | 'terminusGlobe' | 'terminusCross' | 'terminusBox' | 'cycle'
         | 'lifelineHead' | 'arrowhead';
    slots: Uint32Array; position: Float32Array; scale: Float32Array;
    tone: Uint8Array;                     // body tone (theme tone table index)
    tone2: Uint8Array;                    // ring / fill / coverage tone
    fill: Float32Array;                   // 0..1: the coverage arc for a disc, the fill band for a tower
    flags: Uint8Array;                    // bits: DIM, SHELL, DOC, INTERCHANGE, OUTLINE, PULSE, SELECTABLE
    number?: Uint16Array;                 // a pin's count (drawn in the shader)
    tooltip?: string[];                   // per slot; the hover tooltip replaces SVG <title>
}

interface LinkBatch {
    family: 'route' | 'edge' | 'describes' | 'wall' | 'arrow';
    points: Float32Array;                 // polylines with breaks; corners pre-rounded by the worker
    runLength: Float32Array;              // running length along the polyline (continuous dashes)
    tone: Uint8Array; width: Float32Array; dash: Uint8Array;   // per segment; dash = pattern id (9/7, 3/5, 2/5, 5/4, 2.5 wall)
    casing?: { tone: number; extra: number };                  // the background underlay under every hop
    widthUnit: 'world' | 'px';            // Transit/Tower scale with zoom (world); graph edges are px
    flags: Uint8Array;                    // per segment: DIM (blend toward the background colour, never alpha), FLOW, PICKABLE
    slot?: Uint32Array;                   // per segment: the line key, so a line can be selected
    aggregate?: Uint32Array;              // a bundle's edge count
}

interface LabelRun {
    slot: number; text: string; position: Vec3; offsetPx: [number, number];
    font: 'mono'; size: number; weight: 400 | 500 | 700; anchor: 'start' | 'middle' | 'end';
    tone: number; halo: { tone: number; px: number };
    note?: { text: string; tone: number };   // the accent second line
    priority: number;
    scale: 'world' | 'screen';            // world = placed once (Transit, Tower); screen = placement redone when zoom settles
}

interface CameraRig {
    projection: 'orthographic' | 'perspective';
    frame: 'fill' | 'document';           // document = sized to content; the page scrolls; no wheel capture
    home: { position: Vec3; target: Vec3; up: Vec3 };
    depth: { tilt: [min: number, max: number]; orbit: boolean };
}
```

A camera's `CameraDef` (`surface/cameras.tsx`) gains `spec` and `rig`. A new camera is registry data, never a branch inside the stage.

### B2. The six cameras

| Camera | Home view | Depth axis | Frame |
|---|---|---|---|
| Transit | the mockup's flat map (bands, routed lines, stations) | layer tier | document |
| Tower | the mockup's 2.5D map (see below) | tower height = size channel | document |
| Graph | partitions as bands, nodes by importance (looks like today's 2D) | partition, so the bands become stacked planes | fill |
| Map | radial folder tree | folder depth, so the tree becomes a cone | fill |
| 3D | today's scene | free orbit | fill |
| Sequence | lifelines left to right, time top to bottom | each stop's layer, so a hop that skips or climbs a layer moves in depth | document |

- **Every mark is unlit, in flat token colours.** The 3D camera's lit spheres are the only exception.
- **Tower.** The mockup's tower is not a projection of anything: top ellipse 0.44, shadow 0.42, a 6 px right side face in `towerSide`, a brightened top, and an unforeshortened map plane. So the home view draws each tower as an **unlit, screen-facing SDF quad (`towerSprite`)** that reproduces `TowerMark`'s 2D drawing exactly: body, side face, top, shadow, coverage tint, the 2 px fill line, and the dashed shell. When the user tilts into depth, `towerSprite` swaps to the real-geometry `tower` (the 3D camera's cylinders), with height = size channel and the fill band from `fill`/`tone2`.
- **Camera switch.** No tweens in this PRD. The rig jumps to the new home view with a 150 ms fade, or with no fade when reduced motion is on.
- **System, Heat and List stay DOM.** List is also the no-WebGL fallback (B7).
- **Gestures:**
  - On `fill` frames, wheel zooms.
  - On `document` frames, wheel scrolls the page (as today) and zoom uses the overlay's +/− and Fit buttons. Tilt comes only from the depth control.
  - On touch, one finger pans or scrolls, a pinch zooms, and tilt uses the depth control only, never a two-finger gesture, so tilt never collides with pinch or page scroll.
  - The stage registers through the existing `usePanZoomRegistration` (`surface/zoom.tsx`), so +, −, Fit and `ScaleLine` keep working.

### B3. The renderer (`src/stage/`)

- **The canvas:**
  - One persistent R3F `<Canvas frameloop="demand">` per `KnowledgeGraphView`, mounted under the graph cameras.
  - The three.js chunk is prefetched on idle while the graph loads, because Transit (the default camera) now needs it.
  - Shaders are warmed with `renderer.compileAsync` when the stage mounts.
  - drei is kept out of the stage: `OrbitControls` comes from `three/addons`, and troika is imported directly.
- **`StageRenderer` port.** The WebGL implementation, plus a no-op implementation for jsdom. With the no-op, the a11y list, the DOM overlays, the cards and picking still mount and work.
- **Marks:**
  - Each batch is ONE `InstancedMesh`.
  - `disc` is one SDF quad shader that draws every station ring: backing, interchange backing, back-disc, the coverage arc from `fill`/`tone2`, the dashed outline, the pulse (a time uniform) and selection.
  - Capacity grows by doubling, with a rebuild.
  - Removed slots become zero-scale holes, compacted only on a full rebuild, so key → slot stays stable.
  - Uploads are ranged (`addUpdateRange`).
- **Links: one instanced-quad line shader of our own (about 150 lines), the same shader for every family.** It does:
  - colour, width and dash per segment;
  - running-length dashes along a polyline;
  - round joins and caps with no overlap blending;
  - the casing in the same pass;
  - anti-aliasing via `fwidth` without MSAA, so 1.5 px describes links stay crisp at DPR 1;
  - world or pixel width.

  The worker samples `roundedPath`'s corners (radius 14) into the polyline.
- **Labels:**
  - JetBrains Mono names use troika `BatchedText`: one draw call, the halo through `outlineWidth`/`outlineColor`.
  - `troika-three-text` becomes a declared peer.
  - The fallback-font CDN download is disabled.
  - Font URLs come from the host through a port, from the hosts' `@fontsource` files; check that troika reads woff2, or ship woff/ttf.
  - **UI-font captions are positioned DOM text** in a caption layer that moves with one CSS transform on pan or zoom: band titles, wall label, describes label, terminus names, plane captions (at most about 60). That gives exact Inter rendering, i18n glyph fallback and accessibility.
  - The cycle mark and the terminus glyphs are mark shapes, not text.
  - `labelPlacement` gets a spatial grid (today it is O(n²)) before Graph uses it.
- **Overlay.** Selection ring, hover and path highlight. Pins are a `MarkBatch` (they are per-station data and clickable), not overlay.
- **Cards.** A card is anchored with `useSlotAnchor(key)`, which writes the card's transform from the frame loop with no React commit. This replaces `useCardAnchor`.
- **Theme.** A theme flip rewrites only the tone colour attributes. Dimming blends toward the background colour.
- **Decorative motion** (the flow on the selected line, pulse) runs continuous frames only while visible, is capped at 30 fps, and is off when reduced motion is on.
- **Context loss.** Restore from the last spec. Browsers cap WebGL contexts and VS Code runs many webviews.

### B4. Detail by zoom

- **Bundles.** Bundles are made only between the aggregate marks visible at the current LOD band, keeping the top K by count. The rest are counted in `caption`.
- **Detail.** Individual edges are drawn for the selection (complete) and inside the viewport above the band threshold.
- **Aggregate marks.** Folders aggregate below a screen-size threshold. Communities (builderforce-memory `communities.ts`, owned by another session) replace folders once that work is published.
- **Thresholds.** Marks, labels and links each have their own threshold.

### B5. Picking and accessibility

- **The grid lives on the main thread.** The worker sends `pick` as typed arrays: a grid over each pickable's projected screen box, including the extruded tower body, line segments, pins, satellites and lifelines. The main thread queries it directly, so select and hover never wait behind a worker task.
- **The exact phase** is today's `hitTest.nearestHit`: nearest centre in screen pixels, ties broken by importance then id, a 40 px target.
- **The ranked incident index** is sent once as typed arrays, so select slices incident edges on the main thread.
- **Accessibility uses positioned proxies, not an off-screen list.** Transparent focusable buttons sit over the projected Tab-stop marks, repositioned when the camera settles, so magnifiers and touch screen readers find them by position.
  - Each proxy carries `aria-label`, `aria-pressed` and `aria-current="step"`, and the view description, from `spec.a11y`.
  - Focusing an off-screen slot pans the camera to it.
  - `useRoving` widens from SVG to `Element`.
  - Focus return after a card closes (`focusStation`) and Map's Escape/Backspace "Out" target the proxies.

### B6. Long tasks in the worker

Worker tasks are chunked. The protocol carries **priority and cancel**, so an interactive task (a spec refinement after zoom settles, or a selection) jumps ahead of `insightsOf` or a layout.

### B7. Update rules

| Change | Work |
|---|---|
| Selection | overlay + incident slice (main thread); card anchor |
| Question / lens / lit set | flags only (DIM, lit) |
| Overlay binding | tone, tone2, fill and width attributes only |
| Tower roles / Show in Tower | flags + tone only |
| Path strip highlight | link flags only |
| Unfold | satellite marks + re-placed labels (worker) |
| Drill enter / exit | a new spec |
| Zoom settles in a new LOD band | a spec refinement (worker) → slot patch |
| Resize | rig + label pass for `screen` labels |
| Theme | tone colours |

### B8. Retired on parity

**Delete, each in the phase that reaches parity:**
- `graph2d/Graph2D.tsx`;
- `map/MindMap.tsx` and `map/MindBranches.tsx`;
- `surface/TransitMap.tsx`'s SVG body and the transit marks (`surface/transit/StationMark.tsx`, `TowerMark.tsx`, `TerminusMark.tsx`, `TransitBands.tsx`, `HopPath.tsx`, `DocLinks.tsx`);
- `useCardAnchor.ts`;
- `scene/GraphScene.tsx` and `scene/Towers.tsx`;
- the main-thread use of `scene/buffers.ts` (`groupEdges` and `edgeBuffers` become worker code);
- `usePanZoom.ts` and `useSvgScale.ts`, when no camera uses them.

**Helpers that tests import** (`towerGeometry`, `byDepth`) move into the spec builders.

**Moves:** `surface/transit/useTransitModel.ts` becomes `compute/tasks/spec/transit.ts`. `StationCard` keeps the main-thread data it needs (index, findings, satellites) from the spec result.

**Rewires:** `cameras.tsx`'s Suspense fallback for 3D (currently `Graph2D`) becomes the stage's loading state.

**Sequence and the path strip.** `PathStrip.tsx` draws `SequenceView` inline. When Sequence moves onto the stage (P5), the strip keeps a compact DOM rendering of the stops, and the SVG sequence body is deleted.

**Keep:** the pure models (layouts, stations, lines, `labelPlacement`, `cardPlacement`, `sequenceModel`). They feed the spec builders.

**No WebGL** (including software rendering, via `failIfMajorPerformanceCaveat`): the List camera. Log a telemetry event so any future snapshot fallback is decided by data. `env.webgl` resolves before the first camera is picked, so the default camera never flips.

**Memory.** "Tower = 2.5D SVG" (`knowledge-view-must-match-design`) is superseded by "Tower = the mockup's drawing as `towerSprite` on the stage". Update the memory when P2 ships.

## Tests

- **`StageRenderer` port.** jsdom uses the no-op renderer. Role, keyboard and flow tests (`getByRole('button')`, card flows, roving) keep working against the proxies and the DOM overlay.
- **Test migration, an exception to "consolidation tests run unchanged" (operator approved 2026-11-08, for this PRD only).** Today's SVG-structure assertions query SVG elements:
  - `path[data-edge]`, `[data-describes-link]`, `animate`, `circle[r="17"]`, `[data-tower-part="shadow"]`, `[data-stub-colour]`, `g[data-id]`;
  - in `Graph2D.test.tsx`, `transit/marks.test.tsx`, `TowerMark.test.tsx`, `TransitMap.card.test.tsx`, `MindMap.test.tsx`.

  These can't survive an SVG-free renderer. Each one is rewritten as a spec-builder assertion of **the same fact**: a dashed untested segment, a casing, a describes link, the satellite count, a tower shadow. A migration table in the P1 PR maps every old assertion to its replacement. Every non-structural test runs unchanged.
- **Each spec builder** has pure unit tests: counts, slots, bundling, LOD thresholds, update-rule patches.

## Done checks (automated)

- **A Playwright run** on the synthetic harness graph, for every graph camera:
  - `PerformanceObserver('longtask')` records **no main-thread task > 50 ms** from graph load to first frame;
  - frame timing over a scripted pan, zoom, tilt and orbit holds **60 fps**;
  - first frame **≤ 1 s** after the graph arrives;
  - camera switch **≤ 300 ms**.
- **Draw calls at overview: at most 17.** That is 1 plane batch, about 6 mark batches, about 4 link families, 1 `BatchedText`, about 3 overlay meshes, plus 2 headroom.
- **The design-match audit** is a fresh Opus audit with screenshots at DPR 1 and 2, in both themes and at 360 px wide, diffed region by region against today's SVG and the mockup. It checks:
  - the colour, width and casing of every line;
  - round joins and corners at radius 14, with no cap blobs on dimmed lines;
  - lanes 6 px apart (`LANE_GAP`);
  - dash patterns 9/7, 3/5, 2/5 and 5/4, and the 2.5 px dashed walls;
  - crisp 1.5 px describes links;
  - label halos and fonts (Inter / JetBrains Mono at the 11/10 px roles);
  - the Tower's side face, top tone and shadow, and pins above the tower top;
  - band alternation and band title colour;
  - the 360 px document scroll.
- **Mockup location.** The mockup is the claude.ai artifact https://claude.ai/artifact/BfKJSBrTVErwTd7w2Xz6fx (page `#page-dcb81aee8d83`). Read it with the Artifact tool's `read` action, never by fetching the URL. It is not on disk.
- **Retirement.** The B8 files are deleted. `rg "<svg" src/graph2d src/map src/surface/transit` finds no scene SVG (icons and legends are exempt).

## Phases (each one ships)

- **P0:** Part A (in flight).
- **P1a:** a fidelity spike. The Transit home view drawn from today's model output with the new line shader, `disc` shader and `BatchedText`, screenshot-diffed against the SVG at DPR 1 and 2. If it fails, the contract is revised before P1.
- **P1:** the stage core, the `StageRenderer` port, `SpecInput`/`SceneSpec`, slots, picking, proxies, card anchoring and the caption layer, with **Transit** on it, behind a flag, then the default. Delete the SVG transit marks.
- **P2:** **Tower** (`towerSprite` home view, `tower` when tilted). Update the design-match memory.
- **P3:** **Graph and Map**, with bundling, LOD and the `labelPlacement` grid. Delete `Graph2D` and `MindMap`.
- **P4:** the **3D** camera port. Delete `GraphScene` and `Towers`.
- **P5:** **Sequence** on the stage (the depth axis is layer climb), with the path strip as DOM. Delete the SVG sequence body.

## Deferred to the editing PRD (not built here)

Camera-switch slot tweens, the `stage/store.ts` edit model, delta-driven incremental layout, and the gesture → edit → reconcile pipeline. The slot-patch API (B3, B7) is what that PRD builds on.

## Code map

```
src/compute/                 (A2) worker, protocol (+ priority/cancel), client, useComputed
src/compute/tasks/spec/      transit.ts · tower.ts · graph.ts · map.ts · scene3d.ts · sequence.ts
                             bundle.ts · lod.ts · pickGrid.ts · a11y.ts · input.ts (SpecInput guards)
src/stage/
  Stage.tsx                  the ONE canvas; lazy; StageRenderer port selection
  renderer.ts                StageRenderer port + WebGL + no-op implementations
  types.ts                   SceneSpec, SpecInput, MarkBatch, LinkBatch, LabelRun, Caption, A11yItem, CameraRig
  slots.ts                   key→slot, capacity doubling, holes, ranged uploads
  marks/Instanced.tsx        one component for every shape (a geometry and shader table)
  marks/shaders/             disc.ts · towerSprite.ts · pin.ts
  links/Links.tsx + links/shader.ts   the one line shader
  labels/BatchedLabels.tsx   troika BatchedText
  captions/CaptionLayer.tsx  DOM UI-font text, one transform
  overlay/                   Selection.tsx · Hover.tsx · PathHighlight.tsx
  rig/useRig.ts · rig/DepthControl.tsx   localized via KnowledgeGraphLabels; registers via usePanZoomRegistration
  pick/usePick.ts            main-thread grid query + nearestHit
  a11y/StageProxies.tsx      positioned focus proxies + useRoving(Element)
  anchor/useSlotAnchor.ts
  fonts.ts                   host font-URL port
```

No file over about 300 lines. One responsibility per module. New cameras arrive as registry data.

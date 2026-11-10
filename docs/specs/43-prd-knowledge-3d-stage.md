# PRD 43 — One 3D stage for every knowledge camera

Status: design, revised after Opus review (2026-11-08, approved with changes); amended 2026-11-10 by the operator (B1a: render the data once, a camera is only a layout; Map = Transit + Tower), Opus-reviewed the same day (approved with changes, folded in). Owner: the knowledge-graph view (`packages/knowledge-graph-view`).

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

### B1a. Amendment 2026-11-10 (operator): render the data ONCE, a camera is only a layout

Operator: "you're rendering the same data using different surfaces — render the data 1 time with the shapes on 1 surface, then lay out the shapes based upon the selection (Map/Tower/3D, etc.)". Opus design review 2026-11-10: approved with changes (folded in below). **B1a supersedes B1's `SpecInput`/`SceneSpec`/`MarkBatch`, B2's Tower bullet, B3's `disc` and capacity rules, B5's worker pick grid, and the deferral of camera-switch tweens.**

1. **`MarkSet` — built once per GRAPH, never per camera, drill or lens.** A drill APPENDS symbol slots (ranged upload into preallocated headroom); a lens, question or overlay change is a `MarkPaint` patch (tone/flags only). Switching camera never rebuilds it, re-uploads it, or creates a mesh.
2. **Shape = node type, the same in every camera.** `markTypeOf(node)` in `src/shapes.ts` over (`kind` ∈ memory `NODE_KINDS` = file/section/symbol/area/entity/claim/fact, plus `missing`; `fileCategory`; `symbolSort`), computed in the worker once per resident graph as `type: Uint8Array`, with a fallback type. Vocabulary: class/type → square, function/method → circle, file(source) → rounded square, test → diamond, doc → tile, config → triangle, style → rounded triangle, data (`fileCategory` gains `.sql`/`.prisma`/migrations → `data`) → drum, section → bookmark, entity → pentagon, claim/fact → small star, missing/external → dashed octagon, aggregates: system/package (aggregate-only, never a node) → hexagon, area/folder → its members' dominant type. **Every 3D shape is its 2D silhouette extruded; flat = extrude 0**, so a node reads the same from above and in depth. The three existing tables (`lenses.ts` `KIND_SHAPE`, mind-map `MapBranch.shape`, `scene/shapeMeshes.tsx`) fold into this one. One legend for every camera. Below ~10 px tone stays the primary cue.
3. **Slot universe and parents.** One slot table per graph: `node:<ref>` for every node of the whole graph (not the 2,000-node focus cap), `st:<id>` per station aggregate, `dir:<path>` per mind-map folder; forest arrays `parentStation: Int32Array` and `parentFolder: Int32Array`. Satellites and drilled symbols are member slots; Sequence lifelines reuse `st:` slots. Decorations (pins, termini, cycle, satellites' badges, arrowheads) are ONE SDF `glyph` batch with a glyph-id attribute.
4. **`Placement` — all a camera supplies.** A pure worker task writes position, scale and extrude for EVERY slot, plus the camera's links, planes, captions, slot-relative labels, a11y order, caption counts, bounds and rig. A hidden slot is anchored at its nearest visible ancestor (scheme `station` | `folder`, named by the placement) at scale 0; a hidden aggregate sits at its members' centroid at scale 0 — visibility is scale. The vertex shader culls scale 0.
5. **Tween.** Two attribute pairs `(posA, scaleA, extrudeA) → (posB, scaleB, extrudeB)` mixed by a uniform `t` over ≤ 400 ms; reduced motion jumps. Map → Graph: members grow out of their station while it shrinks into the centroid; the reverse collapses them. LOD band changes, unfold and drill use the same mechanism. Labels fade during a tween and are placed after; picking is off during a tween.
6. **Cache.** Placements are an LRU keyed by graph digest + camera + drill + unfolded + pathId + viewport band + lod band — never selection. Returning to a camera is a buffer swap with no worker trip. Layout never re-runs on a re-render or a scrollbar wobble; the rig re-fits, re-placement happens only when the width crosses a band.
7. **Map = Transit + Tower, ONE camera (operator: "Combine the Tower / Map — they are the same thing").** Flat home view; the depth control tilts it and extrudes each station into its tower (height = size channel). A tower is the station's silhouette extruded; the coverage ring follows the outline (operator supersedes the mockup's disc). Graph, Mind map, 3D and Sequence are other placements of the SAME marks.
8. **Every representation is a 3D modelling surface (operator, 2026-11-10: "Even use the 3D graph visuals for sequencing diagrams; every representation is a 3D modeling surface; the sequencing diagram should be composed of the same artifacts that were drawn on the surface").** Sequence is a placement, not a diagram type: its participants ARE the type-shaped marks already on the stage (the stations/nodes on the path), which tween from where they stood into a row; each lifeline is a decoration hanging from that mark; each message is a link between those same slots, ordered along the time axis, with layer climb as depth. Selecting a participant selects the same slot in every camera. The path strip ("where does it go") shows the same marks. System, Heat, Style and Features are placements of the same marks too (System = systems as hexagon aggregates on planes; Heat = the marks on a grid, height/tone = heat; Style/Features = the marks grouped into their view's planes). **There is no 4+1 camera** (operator, 2026-11-10). 4+1 is a checklist, not a view: every aspect is covered by an existing camera, as recorded in `src/fourPlusOne.ts` and checked by its test.
- Logical → Graph and the class band.
- Development → Map and System.
- Process → Sequence.
- Scenarios → Sequence from entry points, and Features.
- Physical → whatever that coverage map proves, or a gap.

The old 4+1 view retires at make-default. **Only List stays DOM** — the accessible list and the no-WebGL fallback.

9. **Semantic zoom is the navigation (operator, 2026-11-10: "at a macro level you see a system (logical grouping — a directory, or DDD/layer associations); then the user zooms in like on a map: the detail reveals composition and associations with Classes; zoom further: Methods; zoom in to reveal the Code").** One continuous zoom on one surface replaces "Go inside" as the primary way down (the card's Go inside becomes a shortcut that animates the same zoom). Four abstraction bands, each a level of the SAME slot forest, entered by screen size of the parent mark, not by a click:
   - **System** — systems/apps (hexagon aggregates) grouped by directory or by DDD context / layer (the grouping scheme is a choice; layers are the planes). Links = system-to-system dependencies, bundled.
   - **Module / class** — as a system's mark grows past the threshold, its members fade in around it (the parent tweens into a translucent hull): files/modules and the classes/types they declare, with **composition and association links** between classes (owns/contains, extends/implements, uses/calls, imports) — distinct link families with their own dash/tone.
   - **Method** — as a class grows, its methods/functions appear as circle members inside it; call links between methods; the class's fields/data as drum members.
   - **Code** — as a method grows past the last threshold, its source is revealed in place: a DOM code layer (syntax-highlighted, read-only in this PRD, editable in the editing PRD) anchored to the method's slot with `useSlotAnchor`, scaling with the zoom until it hands off to the editor (VS Code: "open at line" reveals the real editor; web: the code drawer).
   Rules: every band is ONE placement family (members placed relative to their parent so a zoom is a continuous tween, not a camera switch); the band thresholds live in `lod.ts` as data; zoom out collapses members back into the parent; labels at each band are the band's names (system names, class names, method signatures). **Data:** classes/methods come from symbol records (`withSymbolRecords`, the drill's `symbols` op) — loaded lazily for the systems/classes entering the viewport at the module band, prefetched one band ahead, appended as slots (rule 1); class↔class composition/association edges and method↔method call edges must be carried by the knowledge graph's symbol extraction — the memory package does NOT emit them today (checked 2026-11-10: `EDGE_KINDS` = references, links, contains, mentions, duplicate, near-duplicate, contradicts, agrees, supersedes, about, co-changed — no extends/implements/composes/uses/calls), so phase **P0b** adds them in builderforce-memory's code extractor (`extends`, `implements`, `composes` (field of a class type), `uses` (type reference), `calls` (method → method, resolved within the root, unresolved calls to externals as terminus edges)), with the pack format change, contract snapshot and one regression test per kind, published before the module band ships. They are never invented in the view. Code text comes from the host (`readSource(rootId, path, range)`, local file in the editor, server copy on the web), never shipped in the graph.
10. **Sequence follows the same zoom (operator, 2026-11-10: "the sequence diagrams need this association too").** A sequence is drawn at the band the user is zoomed to, from the same slots and the same symbol-level edges:
   - **System band** — participants are systems; messages are the bundled system→system dependencies along the path.
   - **Class band** — participants are the classes on the path; messages are the `calls` between their methods (labelled with the method), with `extends`/`implements`/`composes` shown as the participant's association stubs so the reader sees why one class can reach another.
   - **Method band** — participants are the methods; each message is one call, ordered by **call-site order** (the order the calls appear in the caller's body), with activation bars for nested calls and a return marker; an unresolved/external call ends at an external terminus.
   - **Code band** — selecting a message reveals the call-site line in the code layer.
   Zooming the sequence moves between bands exactly like the map: a system participant splits into its classes, a class into its methods (member tweens, rule 5). The path strip follows the same band. **Data:** `calls` edges carry the call site (`path`, `line`, `column`) and an `order` index within the caller so a sequence is the real call order, not an inference from file hops (P0b).

**Contract (replaces B1's types):**

```ts
interface MarkSet { generation: number; digest: string; keys: string[]; slotKind: Uint8Array; type: Uint8Array;
  parentStation: Int32Array; parentFolder: Int32Array; label: string[]; tooltip: string[];
  batches: { type: number; slots: Uint32Array }[]; capacity: number }
interface MarkPaint { generation: number; tone: Uint8Array; tone2: Uint8Array; fill: Float32Array; flags: Uint8Array }
interface Placement { generation: number; cacheKey: string; anchor: 'station' | 'folder';
  position: Float32Array /*3N*/; scale: Float32Array; extrude: Float32Array;
  links: LinkBatch[]; planes: PlaneSpec[]; labels: LabelRun[] /*slot-relative*/; captions: Caption[];
  a11y: A11yItem[]; caption: { shown: number; total: number; capped: boolean }; bounds: { min: Vec3; max: Vec3 }; rig: CameraRig }
```

Worker tasks in `protocol.ts` `TaskTable`: `markSet {graph, changed, strings}`, `markPaint {graph, generation, lensId, questionId, overlay, lit, roles, family}` (ranged), `placement {graph, generation, camera, drill, unfolded, pins, pathId, viewportBand, lod}`. Selection stays out of all three. Typed arrays go through `transfer.ts`. `LinkBatch`, `PlaneSpec`, `LabelRun`, `Caption`, `A11yItem`, `CameraRig` keep B1's shapes.

**Done checks added:** a camera switch creates 0 `InstancedMesh` and makes ≤ 3 attribute uploads per batch (renderer spy; capacity overflow is the only rebuild path); a node keeps its type shape and colour in every camera (test over the harness graph); draw calls ≤ ~9 type batches + 1 glyph + 1 plane + ~4 link families + 1 text + ~3 overlay.

**Interim fixes (2026-11-10)** — Map flicker, Tower tab folded into Map, Graph2D layout, per-renderer type shapes, the Go-inside crash, the error boundary — keep the current cameras usable until their placements land; the renderers they touch retire per B8, and the `shapes.ts` registry becomes rule 2's single source.

#### P1a results (2026-11-10)

**What was built** (P1's foundation, behind the `kg.stage = spike` opt-in — `localStorage` in the VS Code webview, `?kgStage=spike` or `localStorage` on the web; `ViewSurface` mounts `stage/spike/StageSpike.tsx` in place of Transit/Graph only then):
- worker tasks `markSet`, `markPaint`, `placement` in `TaskTable` (`compute/tasks/stage.ts`; builders `markSet.ts`, `markPaint.ts`, `stageModel.ts`, `placement/{map,graph,anchor,links,request,index}.ts`). `markSet` types every slot with `markTypeOf`; `placement/map.ts` reads `layoutTransit` and `placement/graph.ts` reads `layout2d` unchanged; `anchor.ts` implements rule 4 (hidden aggregate at its visible members' centroid, hidden node at its nearest placed ancestor, scale 0).
- `src/stage/`: `types.ts` (the contract), `tones.ts`, `slots.ts`, `stats.ts`, `tween.ts`, `marks/{geometry,shader,MarkLayer}.ts` (one `InstancedMesh` per type batch, walls of `shapeGeometry`'s extrusion + one SDF cap quad, A/B sets mixed by `uT`), `links/{shader,LinkLayer}.ts` (the one instanced-quad line shader), `renderer.ts` (`StageRenderer` port: WebGL + no-op), `Stage.tsx` (one `<Canvas frameloop="demand">`), `pick.ts`, `StageProxies.tsx`.

**How it was measured.** A scratch page bundled with esbuild from the package sources, run in headless Chromium 145 (playwright-core) on the **real GPU** — `ANGLE (AMD Radeon(TM) Graphics (0x1681) Direct3D11)`, an integrated GPU — at 1280×800, DPR 1. Frame time = `stage.tick` + `renderer.render` + a 1-px `readPixels` (forces the GPU to finish, so it is CPU + GPU time per frame and pessimistic). Uploads and mesh creations are the stage's own counters (`stats.ts`; every upload goes through `uploadRange`), cross-checked in the unit test by the attributes' `version`. Six alternating Map↔Graph switches per graph, 400 ms tween. The "10k" graph is `buildPerfGraph({ scale: 3.19 })` (9,979 nodes, 505,596 edges, 11,243 slots) with Graph at lod 1 (every node shown, all 11k slots move); its scaled-up outline collapses to 2 stations, so its Map side is small — the switch still moves every slot. Artifacts (PNGs, `results.json`) are in the session scratchpad, `p1a/gpu/`.

| | harness (3,138 nodes, 3,975 slots, Graph shows 2,000) | 10k (9,979 nodes, 11,243 slots, Graph shows 9,979) |
|---|---|---|
| Tween frame p50 / p95 / max | 9.2 / 13.7 / 26.4 ms (an earlier run: 5.0 / 6.7) | 18.4 / 22.0 / 25.1 ms; rAF interval p95 33 ms |
| `setPlacement` (main thread, the swap itself) | 0.1–0.4 ms | 0.4 ms |
| InstancedMesh created per switch | **0** (6 of 6 switches) | **0** |
| Attribute uploads per mark batch per switch | **2** (`place` of the stale set + `extrudeAB`) | **2** |
| Bytes uploaded per switch | 93 KB → Graph; 144 KB → Map (+ 3 link uploads, 72 hops) | 264 KB either way |
| Draw calls | 2 type batches + 1 route family | same |
| First frame incl. shader compile | 253 ms | 303 ms |
| Worker side (once, cached) | stage model 1.23 s (`buildStations` + `buildLines` dominate), paint 30 ms, Map 22 ms, Graph 463 ms | 1.93 s, 68 ms, 11 ms, 5.7 s |

**Shapes at 6 / 8 / 12 px** (13 types, one row per size and DPR; metric = XOR / union of the thresholded silhouettes, < 0.10 counted indistinguishable):

| | DPR 1 | DPR 2 |
|---|---|---|
| 6 px | source/data, function/source, function/data | class/source, style/config |
| 8 px | source/data, function/system, class/data, function/source | class/source, class/data |
| 12 px | class/source, style/config | class/source, source/data, class/data, style/config, function/system |

(12 px at DPR 1 and 6 px at DPR 2 rasterise to the same device pixels and measured identical — a sanity check of the metric.) Every other pair is distinct at every size. The near-misses are always the same few silhouette pairs, not AA failure: square vs rounded square (corner radius 0.35 of 0.9), triangle vs rounded triangle, circle vs hexagon, drum vs rounded square.

**Line shader vs today's SVG** (harness Map, 72 hops, the same colours; SVG = `HopPath`'s casing + core paths rasterised by the browser): mean absolute difference over inked pixels **6.1 / 255 at DPR 1, 3.5 at DPR 2**; pixels differing by > 32: 6.0 % / 3.8 %. The diff image shows only AA fringes on curves and dash phase on dashed hops (the SVG measures dash length on the true quadratic, the shader on the 6-step sampled corner). Casing, round joins, and later-hop-over-earlier-hop paint order match. **Stations** (36 marks, SDF cap vs `StationMark`'s `ShapePath` + back disc): 22.9 / 255 at DPR 1, 13.2 at DPR 2 — all of it a 1-px ring at the outline: the SVG strokes 2 px of background centred on the outline (insetting the fill 1 px) and backs it with a circle, the cap follows the outline (operator rule 7).

**Found during the spike (fixed):** twelve separate per-instance attributes (`posA`, `scaleA`, … `flags`) plus `InstancedMesh`'s `instanceMatrix` exceed D3D11 ANGLE's 16-attribute limit and **do not link** ("Too many attributes"). The attributes are packed: `placeA`/`placeB` (xyz + scale), `extrudeAB`, `paint` (tone, tone2, fill, flags) — 4 slots + instanceMatrix. Line quads also need `DoubleSide` (their winding depends on segment direction).

**Not measured:** SwiftShader / software GL (the real GPU was available); real browsers' compositor timing (headless); a discrete GPU; text (troika is not in P1a).

**Verdict: PASS, with three B1a revisions.**
1. **Rule 5 / Contract:** the per-slot A/B pairs are *packed* attributes — `placeA`/`placeB` = (x, y, z, scale), `extrudeAB`, and one `paint` vec4 — and a switch is **2** uploads per batch (done check stays ≤ 3). Name them so in P1.
2. **Rule 2 vocabulary:** square/rounded square, triangle/rounded triangle and circle/hexagon cannot be told apart at ≤ 12 px. Before P1 ships the legend, change the rounded variants' silhouettes so they differ at 8 px (e.g. `source` = rounded square with radius ≥ 0.6 or a 4:3 rectangle; `style` = triangle pointing down; `system` hexagon with a flat top and ≥ 1.2 radius), and re-run this metric as a unit test over the registry (`shapes.test.ts`, XOR/union ≥ 0.10 at 8 px DPR 1). Below 8 px tone stays the primary cue, as rule 2 says.
3. **B3 Marks budget:** with every one of 10k marks visible the tween runs 18–22 ms on an integrated GPU (the cap's polygon SDF loop is per fragment). P1 keeps the Graph overview at its 2,000-node LOD cap (hidden slots are culled in the vertex shader for free) and P3's LOD/bundling decides what more is shown; if a camera must show > ~5k marks at once, bake each shape's SDF into a small texture atlas instead of the per-fragment polygon loop.

### B2. The six cameras

| Camera | Home view | Depth axis | Frame |
|---|---|---|---|
| Map (Transit + Tower) | the mockup's flat map (bands, routed lines, stations); tilted = towers | layer tier; tilt extrudes stations (height = size channel) | document |
| Graph | partitions as bands, nodes by importance (looks like today's 2D) | partition, so the bands become stacked planes | fill |
| Mind map | radial folder tree | folder depth, so the tree becomes a cone | fill |
| 3D | today's scene | free orbit | fill |
| Sequence | the path's own marks in a row (tweened from the previous camera), lifelines hanging from them, messages as links top to bottom | each stop's layer, so a hop that skips or climbs a layer moves in depth | document |
| System · Heat · Style · Features (no 4+1 camera: see rule 8) | the same marks placed on that view's planes / grid (B1a rule 8) | plane stack; Heat: height = heat | fill |

- **Every mark is unlit, in flat token colours.** The 3D camera's lit spheres are the only exception.
- **Tower.** SUPERSEDED by B1a rule 7 (a tower is the station's silhouette extruded). Historical note: the mockup's tower is not a projection of anything: top ellipse 0.44, shadow 0.42, a 6 px right side face in `towerSide`, a brightened top, and an unforeshortened map plane. So the home view draws each tower as an **unlit, screen-facing SDF quad (`towerSprite`)** that reproduces `TowerMark`'s 2D drawing exactly: body, side face, top, shadow, coverage tint, the 2 px fill line, and the dashed shell. When the user tilts into depth, `towerSprite` swaps to the real-geometry `tower` (the 3D camera's cylinders), with height = size channel and the fill band from `fill`/`tone2`.
- **Camera switch.** Superseded by B1a rule 3: the same marks tween to the new placement (≤ 400 ms), or jump when reduced motion is on.
- **Only List stays DOM** (B1a rule 8). List is also the no-WebGL fallback (B7).
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
  - One silhouette SDF cap shader with a shape-id attribute draws every type mark's top face (anti-aliased outline, no MSAA): backing, interchange backing, the coverage arc following the outline from `fill`/`tone2`, the dashed outline, the pulse (a time uniform) and selection; extrusion adds the side walls.
  - Capacity is sized at MarkSet build plus drill headroom; a rebuild happens only on overflow.
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

- **Picking is a main-thread pass over the slots' world positions**, re-projected into a screen grid when the camera settles (≈0.3 ms at 10k slots; a worker-built grid would go stale on tilt and orbit), covering the extruded body, line segments, glyphs and lifelines. Off during a tween. Select and hover never wait behind a worker task. Proxies are rebuilt on settle for visible on-screen slots only (≤ ~200), with roving focus.
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
| Camera switch | cached placement swap + tween (worker only on a cache miss) |
| Unfold | placement patch (satellites are member slots) + re-placed labels |
| Drill enter / exit | symbol slots appended (ranged) + a new placement, tweened |
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

**Sequence and the path strip.** `PathStrip.tsx` draws `SequenceView` inline. When Sequence becomes a placement (P2), the strip shows the path's own stage marks (B1a rule 8) and the SVG sequence body is deleted.

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
- **Draw calls at overview:** ≤ ~9 type batches + 1 glyph batch + 1 plane batch + ~4 link families + 1 `BatchedText` + ~3 overlay meshes (B1a).
- **Camera switch:** 0 `InstancedMesh` created, ≤ 3 attribute uploads per batch (renderer spy).
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

## Status (2026-11-10, paused by the operator)

- **Committed:** P0b, P0c, P1a, the P1 stage behind `kg.stage=spike`, the P2–P5 placements, 4+1 Physical (deploy units on the System camera) and the `fourPlusOne.ts` coverage map.
- **Uncommitted, tests red, in the working tree:** P3 Graph parity (built, its own tests pass); make-default/B8 (GraphScene, Towers, shapeMeshes, the 4+1 views and the DOM System/Style bodies deleted; flag removal, `cameras.tsx`, Graph2D/MindMap/transit SVG/panzoom deletion and test migration left); P1b (`useSemanticZoom`, `CodeLayer`, `zoomBand` written but not wired into `useStageWiring`/`StageCard`).
- **Open outside this package:** the `extractorKey` wiring (memory 2026.10.72) and `EXTRACTOR_VERSION` 7 (uncommitted in builderforce-memory; it ships in the next memory version after 2026.10.80).
- The full list lives in ROADMAP.md under this PRD.

## Phases (each one ships)

- **P0:** Part A (in flight).
- **P0b:** builderforce-memory: symbol-level edge kinds (`extends`, `implements`, `composes`, `uses`, `calls`) in the code extractor + pack format + contract snapshot + regression tests; publish; bump memory in every consumer lockfile. Prerequisite for the module and method bands (B1a rule 9).
- **P1a:** spike on the harness graph and a 10k synthetic graph, one canvas: a `markSet` with real types and two placements built from the existing `transitLayout` and `layout2d` outputs; extruded shapes with the SDF cap; the tween. Measured: tween frame time, bytes uploaded per switch, zero mesh creations, shapes distinguishable at 6/8/12 px at DPR 1 and 2, the line shader and stations diffed against the SVG. If it fails, B1a is revised before P1.
- **P1:** the `markTypeOf` registry and the three tasks (`markSet`, `markPaint`, `placement`); slots with A/B attributes; the stage core, `StageRenderer` port, picking, proxies, card anchoring, captions and labels; the **Map (Transit + Tower)** placement (flat home view, tilt = extrude) and a minimal **Graph** placement so the switch check is real — behind a flag, then the default. Delete the SVG transit and tower marks.
- **P1b:** **semantic zoom** (B1a rule 9): system → module/class → method bands as continuous member tweens, lazy symbol slots, the code layer anchored to the method slot, host `readSource`; Go inside becomes the zoom shortcut.
- **P2:** **Mind map** and **Sequence** placements. Update the design-match memory.
- **P3:** **Graph** to full parity, with bundling, LOD and the `labelPlacement` grid. Delete `Graph2D` and `MindMap`.
- **P4:** the **3D** camera port. Delete `GraphScene` and `Towers`.
- **P5:** **System, Heat, Style and Features** placements (B1a rule 8), plus the 4+1 coverage map (`src/fourPlusOne.ts`) proving that every 4+1 aspect has a camera. Retire the 4+1 view. Delete their DOM/SVG scene bodies; List stays DOM.

## Deferred to the editing PRD (not built here)

The `stage/store.ts` edit model, delta-driven incremental layout, and the gesture → edit → reconcile pipeline. The slot-patch API (B3, B7) is what that PRD builds on.

## Code map

```
src/compute/                 (A2) worker, protocol (+ priority/cancel), client, useComputed
src/compute/tasks/           markSet.ts · markPaint.ts · bundle.ts · lod.ts · a11y.ts · input.ts (guards)
src/compute/tasks/placement/ map.ts (Transit+Tower) · graph.ts · mind.ts · scene3d.ts · sequence.ts
src/shapes.ts                markTypeOf + the ONE type → silhouette registry
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

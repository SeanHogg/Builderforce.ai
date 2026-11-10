/**
 * The stage's contract (PRD 43 B1a): the marks are built ONCE per graph (`MarkSet`), painted by lens and overlay
 * (`MarkPaint`), and laid out by a camera (`Placement`). A camera is only a placement: switching camera swaps the
 * placement buffers and tweens; it never rebuilds the marks, re-uploads the paint or creates a mesh.
 *
 * Every type here is structured-clone safe (strings, numbers, typed arrays, plain objects), because all three are
 * built by worker tasks (`compute/tasks/markSet.ts`, `markPaint.ts`, `placement/`). Worker-safe: types only.
 */

export type Vec3 = readonly [number, number, number];

/** What a slot stands for: a graph node, a station aggregate (`st:`) or a mind-map folder (`dir:`). */
export const SLOT_NODE = 0;
export const SLOT_STATION = 1;
export const SLOT_FOLDER = 2;
export type SlotKind = typeof SLOT_NODE | typeof SLOT_STATION | typeof SLOT_FOLDER;

/** Per-slot paint bits (`MarkPaint.flags`, `LinkBatch.flags`). */
export const FLAG = {
    DIM: 1, SHELL: 2, DOC: 4, INTERCHANGE: 8, OUTLINE: 16, PULSE: 32, SELECTABLE: 64,
} as const;

/** Built once per GRAPH (rule 1). `type` indexes `MARK_TYPE_ORDER` (`shapes.ts`); one batch per type present. */
export interface MarkSet {
    generation: number;
    digest: string;
    keys: string[];
    slotKind: Uint8Array;
    type: Uint8Array;
    /** Slot of the station a slot belongs to; -1 for none (a station itself, a folder, an unplaced node). */
    parentStation: Int32Array;
    /** Slot of the folder a slot sits in; -1 for none (the root folder, a node with no path). */
    parentFolder: Int32Array;
    label: string[];
    tooltip: string[];
    /**
     * Per slot, the importance picking breaks distance ties with — the SAME reading `hitTest.nearestHit`'s callers use (a
     * node's `importanceOf`, a station's `use`; a folder 0) — so a pick ties the same way before and after any later data.
     */
    importance: Float32Array;
    batches: { type: number; slots: Uint32Array }[];
    /** Slots the stage preallocates (the slot count plus drill headroom; see `stage/slots.ts` `capacityFor`). */
    capacity: number;
}

/** Tone indices are into `TONE_ORDER` (`stage/tones.ts`); the renderer turns them into colours with one palette uniform. */
export interface MarkPaint {
    generation: number;
    tone: Uint8Array;
    tone2: Uint8Array;
    fill: Float32Array;
    flags: Uint8Array;
}

/**
 * Dash pattern ids (`LinkBatch.dash`): 0 solid, then the transit map's patterns (on, off) in the batch's width unit —
 * world units for a `world` family, CSS px for a `px` one (B3): 9/7 an untested hop, 3/5 a cycle, 2/5 a describes link,
 * 5/4 a layer wall (drawn 2.5 px wide, `LINK_FAMILY_STYLE.wall`).
 */
export const DASH_PATTERNS: ReadonlyArray<readonly [number, number]> = [[0, 0], [9, 7], [3, 5], [2, 5], [5, 4]];
export const DASH_SOLID = 0;
export const DASH_UNTESTED = 1;
export const DASH_CYCLE = 2;
export const DASH_DESCRIBES = 3;
export const DASH_WALL = 4;

/** Every link family the stage draws; the renderer preallocates one mesh per family when it mounts. */
export const LINK_FAMILIES = ['route', 'edge', 'describes', 'wall', 'arrow'] as const;
export type LinkFamily = typeof LINK_FAMILIES[number];

export interface LinkBatch {
    family: LinkFamily;
    /** xyz per point; a NaN triple breaks the polyline. Corners are pre-rounded by the worker. */
    points: Float32Array;
    /** Running length along the polyline at each point (continuous dashes). */
    runLength: Float32Array;
    /** Per segment (between two consecutive non-break points). */
    tone: Uint8Array;
    width: Float32Array;
    dash: Uint8Array;
    flags: Uint8Array;
    /** Per segment: the polyline it belongs to (a hop). Paint order: a later polyline's casing covers an earlier one's core, as SVG does. */
    group: Uint32Array;
    casing?: { tone: number; extra: number };
    widthUnit: 'world' | 'px';
    slot?: Uint32Array;
    aggregate?: Uint32Array;
    /** Per polyline (indexed by `group`): the line it draws (`Line.id`), so a route pick selects that line. */
    lineIds?: string[];
}

export interface PlaneSpec { kind: 'band' | 'partition' | 'lifeline'; min: Vec3; max: Vec3; tone: number }

export interface LabelRun {
    slot: number; text: string; offsetPx: [number, number];
    font: 'mono'; size: number; weight: 400 | 500 | 700; anchor: 'start' | 'middle' | 'end';
    tone: number; halo: { tone: number; px: number };
    note?: { text: string; tone: number };
    priority: number;
    scale: 'world' | 'screen';
}

/**
 * Localized UI-font text the DOM caption layer draws (B3 Labels): band titles, the wall label, the describes label,
 * terminus names, plane captions. `text` is already localized (a catalog string from `SpecInput.strings`, or data such
 * as a layer name) — the stage never supplies words of its own.
 */
export interface Caption {
    text: string; position: Vec3; anchor: 'start' | 'middle' | 'end'; tone: number;
    role?: 'band' | 'wall' | 'describes' | 'terminus' | 'plane';
    /** `mono` for a name the SDF font cannot draw (a glyph outside its range): the DOM gives it the i18n glyph fallback. */
    font?: 'ui' | 'mono';
}

export interface A11yItem { slot: number; label: string; pressed?: boolean; current?: boolean }

export interface CameraRig {
    projection: 'orthographic' | 'perspective';
    frame: 'fill' | 'document';
    home: { position: Vec3; target: Vec3; up: Vec3 };
    depth: { tilt: [min: number, max: number]; orbit: boolean };
}

/** All a camera supplies (rule 4): a position, scale and extrude for EVERY slot (hidden = scale 0 at its anchor). */
export interface Placement {
    generation: number;
    cacheKey: string;
    anchor: 'station' | 'folder';
    position: Float32Array;
    scale: Float32Array;
    extrude: Float32Array;
    links: LinkBatch[];
    planes: PlaneSpec[];
    labels: LabelRun[];
    captions: Caption[];
    a11y: A11yItem[];
    caption: { shown: number; total: number; capped: boolean };
    bounds: { min: Vec3; max: Vec3 };
    rig: CameraRig;
    /**
     * Slots this placement brings that the MarkSet does not hold (a drilled level's loaded symbols, B7 drill enter),
     * numbered from `base` (= the MarkSet's slot count) in order; `position` / `scale` / `extrude` cover them too.
     */
    append?: SlotAppend;
}

/** Slots appended after the MarkSet (B1a rule 1: a drill APPENDS into the preallocated headroom). Same fields as the MarkSet's, per appended slot. */
export interface SlotAppend {
    base: number;
    keys: string[];
    type: Uint8Array;
    slotKind: Uint8Array;
    parentStation: Int32Array;
    parentFolder: Int32Array;
    label: string[];
    tooltip: string[];
    importance: Float32Array;
}

/** The cameras that have a placement today (P1a: Map and Graph). A new camera is a row in `placement/index.ts`. */
export type PlacementCamera = 'map' | 'graph';

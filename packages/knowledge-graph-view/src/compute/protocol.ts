/**
 * The wire between the main thread and the graph compute worker (ONE protocol; the in-process fallback speaks it too).
 *
 * The worker holds graphs RESIDENT: a graph is loaded once (`load-begin`, `load-chunk`*, `load-end`, in slices so no single
 * clone freezes the page) and every task after that names it by {@link GraphId}. A task never ships nodes or edges: it names
 * them by INDEX into the resident arrays (a {@link Refs}), and its answer names them the same way, so the main thread maps
 * the answer back onto ITS OWN objects. Object identity (which `useStableGraph` and the memo chains rely on) is preserved and
 * the reply is a few typed arrays, not a clone of 100,000 edges.
 *
 * Small plain results (stations, lines, insights, mind-map branches) carry only strings and numbers and cross as they are.
 */

import type { Band, Bounds } from '../graph2d/layout2d';
import type { MindMap, MindOptions } from '../map/mindMapModel';
import type { Insights } from '../insights/insightsModel';
import type { AntiPatternGroup } from '../surface/drawers/antiPatternGroups';
import type { LinesModel } from '../surface/lines';
import type { PathModel } from '../surface/path';
import type { Station, StationModel } from '../surface/stations';
import type { EdgeBuffer } from '../scene/buffers';
import type { Layout3D } from '../scene/layout3d';
import type { PartitionCell } from '../graphModel';
import type { EdgePath } from '../graph2d/edgePaths';

/** A graph's identity on the wire. Ids are never reused, so the id IS the generation: a reply for an id nobody holds any more is stale. */
export type GraphId = number;

/** Which elements of a resident graph a task reads, as indices into its `nodes`, `edges` and `findings` arrays. `key` names the content (a memo key). */
export interface Refs {
    graph: GraphId;
    key: string;
    nodes?: Uint32Array;
    edges?: Uint32Array;
    findings?: Uint32Array;
}

/** Positions of some of a subset's nodes: `order[i]` is an index into the subset's nodes, `coords` holds `dims` numbers per entry. Doubles, so a position survives the trip exactly. */
export interface PlacedWire { dims: 2 | 3; order: Uint32Array; coords: Float64Array }

/** The loadable parts of a graph that are big enough to be sent in slices. */
export type LoadField = 'nodes' | 'edges' | 'findings' | 'outlineFiles' | 'outlineLinks';

export interface Layout2DRaw { placed: PlacedWire; bands: Band[]; bounds: Bounds }
export interface Layout3DRaw { placed: PlacedWire; planes: Layout3D['planes'] }

/** The ranking, by position in the request's edges. `incident` is flattened: `refs[i]` owns `edges[offsets[i] .. offsets[i + 1])`. */
export interface RankRaw {
    total: number;
    breaking: Uint32Array;
    rest: Uint32Array;
    refs: string[];
    offsets: Uint32Array;
    edges: Uint32Array;
}

/** What `pathOfStations` and `groupAntiPatterns` read of the stations: the file → station map and each station's name and layer. */
export interface StationLookup {
    /** Names the model this was slimmed from (one number per model): the worker keeps a lookup per graph and reuses it while the key holds, so memos keyed on its maps hit. */
    key: number;
    stationOf: Map<string, string>;
    byId: Map<string, Pick<Station, 'id' | 'name' | 'layer'>>;
}

export interface AntiPatternGroupRaw extends Omit<AntiPatternGroup, 'findings'> { findings: Uint32Array }

/** `whole`: the focus is the graph itself (the very same arrays), so nothing else is sent. */
export interface FocusRaw { whole: boolean; nodes: Uint32Array; edges: Uint32Array }

export interface SurfaceRaw { stations: StationModel; lines: LinesModel }
export interface MatrixRaw { partitions: string[]; cells: Map<string, PartitionCell> }

/** Every task: what the main thread asks (`req`) and what the worker answers (`raw`). */
export interface TaskTable {
    layout2d: { req: { refs: Refs; rootId: string }; raw: Layout2DRaw };
    layout3d: { req: { refs: Refs; rootId: string }; raw: Layout3DRaw };
    rankEdges: { req: { refs: Refs }; raw: RankRaw };
    /** The drawn edges of the 2D graph as SVG path data, one per tone bucket (ranked, picked and grouped in the worker). */
    edgePaths: { req: { refs: Refs; placed: PlacedWire }; raw: EdgePath[] };
    /** The drawn edges of the 3D scene as line-segment buffers for a selection. */
    edgeBuffers: { req: { refs: Refs; placed: PlacedWire; selected: string | null }; raw: EdgeBuffer[] };
    mindMap: { req: { refs: Refs; opts: MindOptions }; raw: MindMap };
    surface: { req: { graph: GraphId; changed: string[]; repoConfigName?: string }; raw: SurfaceRaw };
    path: { req: { graph: GraphId; refs: string[]; stations: StationLookup }; raw: PathModel };
    insights: { req: { graph: GraphId }; raw: Insights };
    partitionMatrix: { req: { graph: GraphId }; raw: MatrixRaw };
    focus: { req: { graph: GraphId; max: number; keep: string[] }; raw: FocusRaw };
    antiPatterns: { req: { graph: GraphId; layer: string | null; stations?: StationLookup }; raw: AntiPatternGroupRaw[] };
}

export type TaskKind = keyof TaskTable;

/** Main → worker. */
export type WorkerIn =
    | { type: 'load-begin'; graph: GraphId; shell: object; outline: object | null }
    | { type: 'load-chunk'; graph: GraphId; field: LoadField; items: readonly unknown[] | Uint32Array }
    | { type: 'load-end'; graph: GraphId }
    | { type: 'drop'; graph: GraphId }
    | { type: 'run'; id: number; graph: GraphId; kind: TaskKind; req: unknown }
    | { type: 'cancel'; id: number };

/** Worker → main. `graph` echoes the request's, so a reply for a graph that has since been dropped can be told apart. */
export type WorkerOut =
    | { type: 'done'; id: number; graph: GraphId; raw: unknown }
    | { type: 'failed'; id: number; graph: GraphId; message: string };

/**
 * Where a file sits on the map (PRD 38 P1): THE one reading of memory's `placementOf` the view uses for
 * every bucket, plane, lane and group. A node's placement is its pack partition, else the community
 * Louvain put it in, else none. The key is a plain string so it travels through layouts, the worker and
 * `Map` keys unchanged: the partition id itself, or `community:<id>` for a community.
 *
 * SEMANTIC partition reads (the layer ranking, `partition === 'entry'`, layer-rule verdicts, the layer
 * lenses) do NOT go through here: a community is a cohesion group, never a code layer.
 *
 * Community ids are per build: a key is only meaningful inside the graph it was read from, and is never
 * persisted. Its human name is the outline's `communities` table label, read once per graph.
 */

import { communityTable, placementOf, UNPARTITIONED_LANE, type KNode, type KnowledgeGraph, type LanedTrace } from '@seanhogg/builderforce-memory/knowledge';
import { cmp } from './order';
import { fillTemplate } from './template';

/** The prefix of a community placement key. */
export const COMMUNITY_KEY_PREFIX = 'community:';

/** The placement key of a community id. */
export const communityKey = (id: number): string => `${COMMUNITY_KEY_PREFIX}${id}`;

/** The ONE key every community folds into past {@link COMMUNITY_PLANE_MAX} (see {@link planeKeyOf}). */
export const OTHER_COMMUNITIES_KEY = `${COMMUNITY_KEY_PREFIX}other`;

/** The ONE read of a node's `communityId` badge; undefined when it has none. */
export function communityIdOf(node: Pick<KNode, 'badges'>): number | undefined {
    const id = node.badges?.['communityId'];
    return typeof id === 'number' ? id : undefined;
}

/** A placement as its key: the partition id, or `community:<id>`. */
const keyOfPlacement = (p: NonNullable<ReturnType<typeof placementOf>>): string => (p.kind === 'partition' ? p.id : communityKey(p.id));

/** A node's placement key: its partition, else `community:<id>`, else undefined (no placement). */
export function placementKeyOf(node: Pick<KNode, 'partition' | 'badges'>): string | undefined {
    const p = placementOf(node);
    return p === undefined ? undefined : keyOfPlacement(p);
}

/** Whether a key names a community, or the folded "other communities" (rather than a pack partition). */
export const isCommunityKey = (key: string | undefined): key is string => key !== undefined && key.startsWith(COMMUNITY_KEY_PREFIX);

/** The community id of a community key; undefined for a partition key, the folded key, or none. */
export function communityIdOfKey(key: string | undefined): number | undefined {
    if (!isCommunityKey(key)) return undefined;
    const id = Number(key.slice(COMMUNITY_KEY_PREFIX.length));
    return Number.isInteger(id) ? id : undefined;
}

/** Rank of a key: pack partitions (0), then communities (1), then none (2). */
export const placementRankOf = (key: string | undefined): number => (key === undefined || key === '' ? 2 : isCommunityKey(key) ? 1 : 0);

/**
 * THE order of placement keys everywhere they are listed (the Partition picker, the list fallback, the matrix):
 * pack partitions by name, then communities by numeric id (the folded "other communities" last), then none (`undefined` or `''`).
 */
export function comparePlacementKeys(a: string | undefined, b: string | undefined): number {
    const ra = placementRankOf(a), rb = placementRankOf(b);
    if (ra !== rb) return ra - rb;
    if (ra === 1) {
        const ia = communityIdOfKey(a) ?? Number.POSITIVE_INFINITY, ib = communityIdOfKey(b) ?? Number.POSITIVE_INFINITY;
        return ia === ib ? cmp(a!, b!) : ia < ib ? -1 : 1;
    }
    return ra === 0 ? cmp(a!, b!) : 0;
}

/** The most communities that keep a plane (or bucket) of their own among the nodes drawn; the rest share {@link OTHER_COMMUNITIES_KEY}. */
export const COMMUNITY_PLANE_MAX = 12;
/** A community smaller than this never gets a plane of its own. */
export const COMMUNITY_PLANE_MIN_SIZE = 2;

/** The plane keys of an array's nodes, and the communities that keep a plane of their own among them. */
interface PlaneTable { keys: ReadonlyMap<object, string | undefined>; kept: ReadonlySet<number> }

const planesBy = new WeakMap<readonly object[], PlaneTable>();

/**
 * The plane key of every node in `among`, read ONCE per array (one `placementOf` per node): the layout, its plane order,
 * the 2D projection, the list and the composition chart all ask per node, and each ask is then a lookup. The kept communities
 * are the largest {@link COMMUNITY_PLANE_MAX} (size, then id) of at least {@link COMMUNITY_PLANE_MIN_SIZE} members.
 */
function planeTable(among: ReadonlyArray<Pick<KNode, 'partition' | 'badges'>>): PlaneTable {
    const held = planesBy.get(among);
    if (held) return held;
    const placed = new Map<object, ReturnType<typeof placementOf>>();
    const size = new Map<number, number>();
    for (const n of among) {
        const p = placementOf(n);
        placed.set(n, p);
        if (p?.kind === 'community') size.set(p.id, (size.get(p.id) ?? 0) + 1);
    }
    const kept = new Set([...size].filter(([, s]) => s >= COMMUNITY_PLANE_MIN_SIZE)
        .sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, COMMUNITY_PLANE_MAX).map(([id]) => id));
    const keys = new Map<object, string | undefined>();
    for (const [n, p] of placed) keys.set(n, p === undefined ? undefined : p.kind === 'community' && !kept.has(p.id) ? OTHER_COMMUNITIES_KEY : keyOfPlacement(p));
    const table = { keys, kept };
    planesBy.set(among, table);
    return table;
}

/**
 * THE plane (or bucket) of a node among the nodes drawn with it: the 3D planes, the 2D bands, the Partition picker,
 * the list fallback and the composition chart. Its placement key, except that a community outside the largest
 * {@link COMMUNITY_PLANE_MAX} (or smaller than {@link COMMUNITY_PLANE_MIN_SIZE}) folds into {@link OTHER_COMMUNITIES_KEY},
 * so a repo with hundreds of communities never draws hundreds of planes.
 */
export function planeKeyOf(node: Pick<KNode, 'partition' | 'badges'>, among: ReadonlyArray<Pick<KNode, 'partition' | 'badges'>>): string | undefined {
    const table = planeTable(among);
    if (table.keys.has(node)) return table.keys.get(node);
    // A node asked about outside the array it is placed among: read it now.
    const key = placementKeyOf(node);
    if (!isCommunityKey(key)) return key;
    return table.kept.has(communityIdOf(node)!) ? key : OTHER_COMMUNITIES_KEY;
}

/** A node's community membership confidence (0..1): the share of its reference weight inside its community. Undefined when it has none. */
export function communityConfidenceOf(node: Pick<KNode, 'badges'>): number | undefined {
    const v = node.badges?.['communityConfidence'];
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

// Keyed by the outline when the graph carries one (live overlays copy the graph but share it), else by the nodes array.
const tables = new WeakMap<object, ReadonlyMap<number, string>>();

/**
 * The community id → label table of a graph, read ONCE per graph: the outline's `communities` when the graph carries one,
 * else memory's `communityTable` over the graph's own files (never a whole outline built just for the table).
 */
export function communityLabels(graph: KnowledgeGraph): ReadonlyMap<number, string> {
    const anchor: object = graph.outline ?? graph.nodes;
    const held = tables.get(anchor);
    if (held) return held;
    const rows = graph.outline?.communities ?? communityTable(graph.nodes.filter((n) => n.kind === 'file'));
    const table = new Map(rows.map((c) => [c.id, c.label] as const));
    tables.set(anchor, table);
    return table;
}

/** The table label of a community; undefined when the table has none for it. */
export const communityLabelOf = (graph: KnowledgeGraph, id: number): string | undefined => communityLabels(graph).get(id);

/** The English default of `labels.communityFallback` (`labels/core.ts` uses it), kept here so the worker path never loads the label catalog. */
export const COMMUNITY_FALLBACK_DEFAULT = 'Community {n}';

/** THE name of a community: its table label, else `fallback` (the host's `communityFallback`) filled with `{n}`. */
export function communityName(graph: KnowledgeGraph, id: number, fallback: string = COMMUNITY_FALLBACK_DEFAULT): string {
    return communityLabelOf(graph, id) ?? fillTemplate(fallback, { n: id });
}

export interface PlacementWords {
    partitionNone: string;
    /** `{n}`: the community id, when the table has no label for it. */
    communityFallback: string;
    /** The one plane / bucket the smaller communities share ({@link OTHER_COMMUNITIES_KEY}). */
    communityOther: string;
}

/** A placement key's human name: the partition itself, the community's table label (else the localized fallback), the shared "other communities", or the word for none. */
export function placementLabel(key: string | undefined, graph: KnowledgeGraph, labels: PlacementWords): string {
    if (key === undefined || key === '') return labels.partitionNone;
    if (key === OTHER_COMMUNITIES_KEY) return labels.communityOther;
    const id = communityIdOfKey(key);
    if (id === undefined) return key;
    return communityName(graph, id, labels.communityFallback);
}

/**
 * A node's Partition row: its placement's name, and for a file placed by its community the membership
 * confidence as a whole percentage (`nodeCommunity`). Undefined confidence ⇒ the name alone.
 */
export function placementRowText(node: Pick<KNode, 'partition' | 'badges'>, graph: KnowledgeGraph, labels: PlacementWords & { nodeCommunity: string }): string {
    const key = placementKeyOf(node);
    const name = placementLabel(key, graph, labels);
    const confidence = isCommunityKey(key) ? communityConfidenceOf(node) : undefined;
    return confidence === undefined ? name : fillTemplate(labels.nodeCommunity, { name, percent: Math.round(confidence * 100) });
}

/**
 * A laned trace with every lane renamed by {@link traceLaneLabel} — `lanes` and the `laneOf` values alike — so the drawn SVG
 * and the copied Mermaid (memory's `toMermaid` prints lanes verbatim) read the same names. A community lane whose label would
 * collide with another lane's reads as the localized `communityFallback` instead (its raw name only if that collides too), so
 * two lanes never merge into one participant.
 */
export function relabelTraceLanes<T extends LanedTrace>(trace: T, graph: KnowledgeGraph, labels: PlacementWords): T {
    const renamed = new Map<string, string>();
    const taken = new Set<string>();
    const clashes = (name: string, lane: string) => taken.has(name) || (name !== lane && trace.lanes.includes(name));
    for (const lane of trace.lanes) {
        const name = traceLaneLabel(lane, graph, labels);
        const n = TRACE_COMMUNITY_LANE.exec(lane)?.[1];
        const fallback = n !== undefined ? fillTemplate(labels.communityFallback, { n }) : lane;
        const own = !clashes(name, lane) ? name : !clashes(fallback, lane) ? fallback : lane;
        renamed.set(lane, own);
        taken.add(own);
    }
    const rename = (lane: string): string => renamed.get(lane) ?? traceLaneLabel(lane, graph, labels);
    const laneOf: Record<string, string> = {};
    for (const [ref, lane] of Object.entries(trace.laneOf)) laneOf[ref] = rename(lane);
    return { ...trace, lanes: trace.lanes.map(rename), laneOf };
}

/** Memory's trace lane of a community (`trace.ts` names it `community <id>`). */
const TRACE_COMMUNITY_LANE = /^community (\d+)$/;

/** A memory trace lane's human name: the community's label for a `community N` lane, the word for none for the unpartitioned lane, else the lane. */
export function traceLaneLabel(lane: string, graph: KnowledgeGraph, labels: PlacementWords): string {
    if (lane === UNPARTITIONED_LANE) return labels.partitionNone;
    const m = TRACE_COMMUNITY_LANE.exec(lane);
    return m ? placementLabel(communityKey(Number(m[1])), graph, labels) : lane;
}

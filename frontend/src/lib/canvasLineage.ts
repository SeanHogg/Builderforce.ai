/**
 * Lineage, freshness, and impact analysis for canvas data objects.
 *
 * WHAT WAS BROKEN
 * A derived object recorded `sourceDatasetId` — a single string saying WHICH
 * dataset it came from and nothing about HOW. The transform was thrown away, so
 * a chart could not be recomputed when its source changed, no object knew it had
 * gone stale, and "what breaks if I drop this column" was unanswerable.
 *
 * This module is the missing record. {@link lineagePatch} is written by every
 * path that derives one object from another — the query tool, the join tool, the
 * data-source query, the metric — so the transform travels WITH the artifact.
 * From that, staleness and impact are derivable rather than guessed.
 *
 * `sourceDatasetId` is still written alongside `lineage`: it is the shape older
 * boards persisted, and {@link readLineage} reads either, so a board saved
 * before this existed still resolves its parent.
 */

import type { TabularQuery } from './canvasTabularData';
import type { TabularJoinSpec } from './canvasTabularJoin';

export const LINEAGE_ENGINES = ['tabular', 'join', 'sql', 'metric', 'import', 'refresh'] as const;
export type LineageEngine = typeof LINEAGE_ENGINES[number];

export interface CanvasTransform {
  engine: LineageEngine;
  /** The declarative query, for `tabular` and `metric`. Replaying this against
   *  the current source is what "refresh" means for a derived object. */
  query?: TabularQuery;
  /** The join spec, for `join`. */
  join?: TabularJoinSpec;
  /** The statement, for `sql`. */
  sql?: string;
  rowsIn?: number;
  rowsOut?: number;
}

export interface CanvasLineage {
  /** Canvas object ids this artifact was computed from, in argument order. */
  sourceIds: string[];
  transform: CanvasTransform;
  /** When this artifact's values were computed. */
  producedAt: string;
  /** Columns the transform read. The basis of column-level impact analysis. */
  columns?: string[];
}

/** Fields a derived object carries. Spread onto the node patch by every
 *  producer, so lineage is never something a call site can forget half of. */
export function lineagePatch(
  sourceIds: readonly string[],
  transform: CanvasTransform,
  options: { columns?: readonly string[]; producedAt?: string } = {},
): Record<string, unknown> {
  const ids = [...new Set(sourceIds.filter(Boolean))].slice(0, 8);
  const producedAt = options.producedAt ?? new Date().toISOString();
  return {
    lineage: {
      sourceIds: ids,
      transform,
      producedAt,
      ...(options.columns?.length ? { columns: [...new Set(options.columns)].slice(0, 60) } : {}),
    } satisfies CanvasLineage,
    // Kept in step deliberately: the single-parent field is what older boards,
    // the "update in place" lookup, and the existing card copy all read.
    ...(ids[0] ? { sourceDatasetId: ids[0] } : {}),
    producedAt,
  };
}

export function readLineage(data: Record<string, unknown>): CanvasLineage | null {
  const raw = data.lineage;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const lineage = raw as Record<string, unknown>;
    const sourceIds = Array.isArray(lineage.sourceIds) ? lineage.sourceIds.map((id) => String(id)).filter(Boolean) : [];
    const transform = lineage.transform && typeof lineage.transform === 'object' ? lineage.transform as CanvasTransform : null;
    if (sourceIds.length && transform && (LINEAGE_ENGINES as readonly string[]).includes(String(transform.engine))) {
      return {
        sourceIds,
        transform,
        producedAt: typeof lineage.producedAt === 'string' ? lineage.producedAt : '',
        ...(Array.isArray(lineage.columns) ? { columns: lineage.columns.map((column) => String(column)) } : {}),
      };
    }
  }
  // Legacy single-parent shape. The transform is genuinely unknown, and saying
  // so is the honest answer — a fabricated one would make replay silently wrong.
  const legacy = typeof data.sourceDatasetId === 'string' ? data.sourceDatasetId : '';
  if (!legacy) return null;
  return {
    sourceIds: [legacy],
    transform: { engine: 'tabular' },
    producedAt: typeof data.producedAt === 'string' ? data.producedAt : '',
  };
}

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

/** Default staleness threshold when no contract declares one. */
export const DEFAULT_FRESHNESS_HOURS = 24;

export interface FreshnessReading {
  /** When the underlying data was last READ from its source. */
  fetchedAt: string | null;
  ageMs: number | null;
  ageHours: number | null;
  slaHours: number;
  stale: boolean;
  /** True when the object has no timestamp at all — a frozen snapshot whose age
   *  is unknowable, which reads differently from "read an hour ago". */
  unknown: boolean;
}

/**
 * How fresh one object's data is.
 *
 * ONE reader for a fact five surfaces need: the dataset card's badge, the
 * derived chart's "as of", the quality suite's freshness check, the refresh
 * action's enablement, and Brain's snapshot.
 */
export function freshnessOf(data: Record<string, unknown>, now = Date.now(), slaHours = DEFAULT_FRESHNESS_HOURS): FreshnessReading {
  const stamp = [data.fetchedAt, data.producedAt, data.importedAt].find((value) => typeof value === 'string' && value);
  const contractSla = readFreshnessSla(data);
  const sla = contractSla ?? slaHours;
  if (typeof stamp !== 'string') {
    return { fetchedAt: null, ageMs: null, ageHours: null, slaHours: sla, stale: false, unknown: true };
  }
  const parsed = Date.parse(stamp);
  if (Number.isNaN(parsed)) {
    return { fetchedAt: null, ageMs: null, ageHours: null, slaHours: sla, stale: false, unknown: true };
  }
  const ageMs = Math.max(0, now - parsed);
  const ageHours = ageMs / 3_600_000;
  return { fetchedAt: stamp, ageMs, ageHours: Number(ageHours.toFixed(2)), slaHours: sla, stale: ageHours > sla, unknown: false };
}

function readFreshnessSla(data: Record<string, unknown>): number | null {
  const contract = data.dataContract;
  if (contract && typeof contract === 'object' && !Array.isArray(contract)) {
    const hours = Number((contract as Record<string, unknown>).freshnessHours);
    if (Number.isFinite(hours) && hours > 0) return hours;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Lineage graph + impact
// ---------------------------------------------------------------------------

/** The minimum an object must expose to take part in lineage. Deliberately not
 *  the canvas node type — this module has no opinion on React Flow. */
export interface LineageObject {
  id: string;
  kind: string;
  title: string;
  data: Record<string, unknown>;
}

export interface LineageGraphNode {
  id: string;
  kind: string;
  title: string;
  role: 'source' | 'derived' | 'both';
  producedAt: string | null;
  fetchedAt: string | null;
  stale: boolean;
}

export interface LineageGraphEdge {
  from: string;
  to: string;
  engine: LineageEngine;
}

export interface LineageGraph {
  nodes: LineageGraphNode[];
  edges: LineageGraphEdge[];
}

export function buildLineageGraph(objects: readonly LineageObject[], now = Date.now()): LineageGraph {
  const byId = new Map(objects.map((object) => [object.id, object]));
  const edges: LineageGraphEdge[] = [];
  const derivedIds = new Set<string>();
  const sourceIds = new Set<string>();

  for (const object of objects) {
    const lineage = readLineage(object.data);
    if (!lineage) continue;
    for (const parent of lineage.sourceIds) {
      if (!byId.has(parent) || parent === object.id) continue;
      edges.push({ from: parent, to: object.id, engine: lineage.transform.engine });
      derivedIds.add(object.id);
      sourceIds.add(parent);
    }
  }

  const nodes = objects
    .filter((object) => derivedIds.has(object.id) || sourceIds.has(object.id))
    .map((object): LineageGraphNode => {
      const freshness = freshnessOf(object.data, now);
      const lineage = readLineage(object.data);
      return {
        id: object.id,
        kind: object.kind,
        title: object.title,
        role: derivedIds.has(object.id) && sourceIds.has(object.id) ? 'both' : derivedIds.has(object.id) ? 'derived' : 'source',
        producedAt: lineage?.producedAt || null,
        fetchedAt: freshness.fetchedAt,
        stale: freshness.stale,
      };
    });

  return { nodes, edges };
}

/** Everything computed from this object, transitively. The answer to "what
 *  breaks if I change this". */
export function impactOf(graph: LineageGraph, objectId: string): string[] {
  return walk(graph.edges, objectId, 'to');
}

/** Everything this object was computed from, transitively. */
export function upstreamOf(graph: LineageGraph, objectId: string): string[] {
  return walk(graph.edges, objectId, 'from');
}

function walk(edges: readonly LineageGraphEdge[], start: string, direction: 'to' | 'from'): string[] {
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of edges) {
      const matches = direction === 'to' ? edge.from === current : edge.to === current;
      if (!matches) continue;
      const next = direction === 'to' ? edge.to : edge.from;
      if (next === start || seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return [...seen];
}

export interface StaleDerivative {
  id: string;
  title: string;
  sourceId: string;
  sourceTitle: string;
  producedAt: string;
  sourceFetchedAt: string;
}

/**
 * Derived artifacts whose source has been re-read since they were computed.
 *
 * This is the concrete "your dashboard is showing March" detector: not an age
 * threshold, but the fact that the parent moved and the child did not follow.
 */
export function staleDerivatives(objects: readonly LineageObject[]): StaleDerivative[] {
  const byId = new Map(objects.map((object) => [object.id, object]));
  const stale: StaleDerivative[] = [];
  for (const object of objects) {
    const lineage = readLineage(object.data);
    if (!lineage?.producedAt) continue;
    const producedAt = Date.parse(lineage.producedAt);
    if (Number.isNaN(producedAt)) continue;
    for (const parentId of lineage.sourceIds) {
      const parent = byId.get(parentId);
      if (!parent) continue;
      const parentFreshness = freshnessOf(parent.data);
      if (!parentFreshness.fetchedAt) continue;
      const parentStamp = Date.parse(parentFreshness.fetchedAt);
      if (Number.isNaN(parentStamp) || parentStamp <= producedAt) continue;
      stale.push({
        id: object.id,
        title: object.title,
        sourceId: parent.id,
        sourceTitle: parent.title,
        producedAt: lineage.producedAt,
        sourceFetchedAt: parentFreshness.fetchedAt,
      });
    }
  }
  return stale;
}

export interface ColumnImpact {
  id: string;
  title: string;
  kind: string;
  /** Where the column shows up in that artifact's transform. */
  usedAs: Array<'select' | 'filter' | 'groupBy' | 'aggregate' | 'sort' | 'join' | 'derive' | 'timeGrain'>;
}

/**
 * Which artifacts read a specific column of a specific source.
 *
 * Column-level impact is the question a data architect actually asks before a
 * rename or a drop, and it is only answerable because the transform is stored.
 */
export function columnImpact(objects: readonly LineageObject[], sourceId: string, column: string): ColumnImpact[] {
  const target = column.trim().toLowerCase();
  if (!target) return [];
  const impacts: ColumnImpact[] = [];
  for (const object of objects) {
    const lineage = readLineage(object.data);
    if (!lineage || !lineage.sourceIds.includes(sourceId)) continue;
    const usedAs = new Set<ColumnImpact['usedAs'][number]>();
    const query = lineage.transform.query;
    const same = (value: unknown) => String(value ?? '').trim().toLowerCase() === target;
    if (query) {
      if (query.select?.some(same)) usedAs.add('select');
      if (query.filter?.some((filter) => same(filter.column))) usedAs.add('filter');
      const groupBy = Array.isArray(query.groupBy) ? query.groupBy : query.groupBy ? [query.groupBy] : [];
      if (groupBy.some(same)) usedAs.add('groupBy');
      if (query.aggregate?.some((aggregate) => same(aggregate.column))) usedAs.add('aggregate');
      if (same(query.sort?.column)) usedAs.add('sort');
      if (query.derive?.some((rule) => rule.when.some((filter) => same(filter.column)))) usedAs.add('derive');
      if (same(query.timeGrain?.column)) usedAs.add('timeGrain');
    }
    if (lineage.transform.join?.on.some((key) => same(key.left) || same(key.right))) usedAs.add('join');
    // A stored column list covers the case where the transform is a plain
    // projection with no query — an imported or refreshed artifact.
    if (!usedAs.size && lineage.columns?.some(same)) usedAs.add('select');
    if (!usedAs.size) continue;
    impacts.push({ id: object.id, title: object.title, kind: object.kind, usedAs: [...usedAs] });
  }
  return impacts;
}

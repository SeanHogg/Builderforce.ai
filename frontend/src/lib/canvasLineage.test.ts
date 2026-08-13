/**
 * Lineage exists to answer three questions the canvas could not answer at all:
 * where did this number come from, is it still current, and what breaks if I
 * change this column.
 */
import { describe, expect, it } from 'vitest';
import {
  buildLineageGraph,
  columnImpact,
  freshnessOf,
  impactOf,
  lineagePatch,
  readLineage,
  staleDerivatives,
  upstreamOf,
  type LineageObject,
} from './canvasLineage';

function object(id: string, kind: string, title: string, data: Record<string, unknown> = {}): LineageObject {
  return { id, kind, title, data: { kind, title, ...data } };
}

const QUERY = { groupBy: 'region', aggregate: [{ op: 'sum' as const, column: 'revenue' }], filter: [{ column: 'state', value: 'closed' }] };

describe('lineagePatch / readLineage', () => {
  it('stores the transform alongside the single-parent field older boards read', () => {
    const patch = lineagePatch(['ds-1'], { engine: 'tabular', query: QUERY }, { columns: ['region', 'sum'] });
    expect(patch.sourceDatasetId).toBe('ds-1');
    const lineage = readLineage(patch);
    expect(lineage?.sourceIds).toEqual(['ds-1']);
    expect(lineage?.transform.query).toEqual(QUERY);
    expect(lineage?.columns).toEqual(['region', 'sum']);
  });

  it('reads a legacy object that has only sourceDatasetId, and says the transform is unknown', () => {
    const lineage = readLineage({ sourceDatasetId: 'ds-legacy' });
    expect(lineage?.sourceIds).toEqual(['ds-legacy']);
    expect(lineage?.transform).toEqual({ engine: 'tabular' });
    expect(lineage?.producedAt).toBe('');
  });

  it('returns null for an object with no provenance at all', () => {
    expect(readLineage({ title: 'a note' })).toBeNull();
  });

  it('de-duplicates parents and drops empty ids', () => {
    const patch = lineagePatch(['a', 'a', '', 'b'], { engine: 'join' });
    expect(readLineage(patch)?.sourceIds).toEqual(['a', 'b']);
  });
});

describe('freshnessOf', () => {
  const now = Date.parse('2026-08-13T12:00:00.000Z');

  it('reads age against the default SLA', () => {
    const reading = freshnessOf({ fetchedAt: '2026-08-13T06:00:00.000Z' }, now);
    expect(reading.ageHours).toBe(6);
    expect(reading.stale).toBe(false);
  });

  it('honours a freshness SLA declared on the object contract', () => {
    const reading = freshnessOf({ fetchedAt: '2026-08-13T06:00:00.000Z', dataContract: { freshnessHours: 2 } }, now);
    expect(reading.slaHours).toBe(2);
    expect(reading.stale).toBe(true);
  });

  it('says UNKNOWN rather than fresh when nothing recorded the read', () => {
    const reading = freshnessOf({ title: 'frozen' }, now);
    expect(reading.unknown).toBe(true);
    expect(reading.stale).toBe(false);
    expect(reading.fetchedAt).toBeNull();
  });
});

describe('buildLineageGraph', () => {
  const objects = [
    object('ds', 'dataset', 'Orders', { fetchedAt: '2026-08-01T00:00:00.000Z' }),
    object('tb', 'table', 'Closed orders', lineagePatch(['ds'], { engine: 'tabular', query: QUERY }, { producedAt: '2026-08-02T00:00:00.000Z' })),
    object('ch', 'chart', 'Revenue by region', lineagePatch(['tb'], { engine: 'tabular', query: QUERY }, { producedAt: '2026-08-03T00:00:00.000Z' })),
    object('note', 'note', 'Unrelated'),
  ];

  it('includes only objects that take part, and labels their role', () => {
    const graph = buildLineageGraph(objects);
    expect(graph.nodes.map((node) => node.id).sort()).toEqual(['ch', 'ds', 'tb']);
    expect(graph.nodes.find((node) => node.id === 'ds')!.role).toBe('source');
    expect(graph.nodes.find((node) => node.id === 'tb')!.role).toBe('both');
    expect(graph.nodes.find((node) => node.id === 'ch')!.role).toBe('derived');
  });

  it('walks impact transitively — a chart two hops down still counts', () => {
    const graph = buildLineageGraph(objects);
    expect(impactOf(graph, 'ds').sort()).toEqual(['ch', 'tb']);
    expect(upstreamOf(graph, 'ch').sort()).toEqual(['ds', 'tb']);
    expect(impactOf(graph, 'ch')).toEqual([]);
  });
});

describe('staleDerivatives', () => {
  it('finds an artifact whose source moved after it was built', () => {
    const stale = staleDerivatives([
      object('ds', 'dataset', 'Orders', { fetchedAt: '2026-08-10T00:00:00.000Z' }),
      object('ch', 'chart', 'March revenue', lineagePatch(['ds'], { engine: 'tabular' }, { producedAt: '2026-03-01T00:00:00.000Z' })),
    ]);
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({ id: 'ch', sourceId: 'ds', sourceTitle: 'Orders' });
  });

  it('is quiet when the artifact is newer than its source', () => {
    expect(staleDerivatives([
      object('ds', 'dataset', 'Orders', { fetchedAt: '2026-03-01T00:00:00.000Z' }),
      object('ch', 'chart', 'Revenue', lineagePatch(['ds'], { engine: 'tabular' }, { producedAt: '2026-08-10T00:00:00.000Z' })),
    ])).toEqual([]);
  });
});

describe('columnImpact', () => {
  const objects = [
    object('ds', 'dataset', 'Orders'),
    object('grouped', 'chart', 'By region', lineagePatch(['ds'], { engine: 'tabular', query: QUERY })),
    object('joined', 'table', 'Orders × customers', lineagePatch(['ds'], { engine: 'join', join: { on: [{ left: 'customer_id', right: 'id' }] } })),
    object('elsewhere', 'chart', 'Other board data', lineagePatch(['other'], { engine: 'tabular', query: QUERY })),
  ];

  it('names how each artifact uses the column', () => {
    expect(columnImpact(objects, 'ds', 'region')).toEqual([{ id: 'grouped', title: 'By region', kind: 'chart', usedAs: ['groupBy'] }]);
    expect(columnImpact(objects, 'ds', 'revenue')[0]!.usedAs).toEqual(['aggregate']);
    expect(columnImpact(objects, 'ds', 'state')[0]!.usedAs).toEqual(['filter']);
    expect(columnImpact(objects, 'ds', 'customer_id')).toEqual([{ id: 'joined', title: 'Orders × customers', kind: 'table', usedAs: ['join'] }]);
  });

  it('returns nothing for a column no artifact reads — the answer to "safe to drop?"', () => {
    expect(columnImpact(objects, 'ds', 'internal_note')).toEqual([]);
  });

  it('ignores artifacts derived from a different source', () => {
    expect(columnImpact(objects, 'ds', 'region').map((impact) => impact.id)).not.toContain('elsewhere');
  });
});

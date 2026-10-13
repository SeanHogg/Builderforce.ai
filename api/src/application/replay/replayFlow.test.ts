/**
 * The Insights flow is THE visitor-journey fold: kept recordings' `steps` are
 * projected into `VisitorFlowRow`s and handed to `buildVisitorFlowGraph` — no
 * second graph builder.
 */
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ build: vi.fn() }));
vi.mock('../../domain/marketing/visitorFlowGraph', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../domain/marketing/visitorFlowGraph')>();
  mocks.build.mockImplementation(real.buildVisitorFlowGraph);
  return { ...real, buildVisitorFlowGraph: mocks.build };
});

import { recordingFlowRows, replayFlow } from './replayFlow';

const SITE = '11111111-2222-4333-8444-555555555555';
const SCOPE = { tenantId: 7, siteId: SITE };
const NOW = new Date('2026-10-12T10:00:00.000Z');

function row(id: string, visitorId: string, steps: string[], extra: { converted?: boolean; errorCount?: number } = {}) {
  return {
    id, visitorId, visitId: `visit-${id}`, startedAt: new Date(NOW.getTime() - 3_600_000), durationMs: 30_000, steps, clicked: [],
    sampleWeight: 1, converted: extra.converted ?? false, errorCount: extra.errorCount ?? 0,
    rageCount: 0, deadCount: 0, quickbackCount: 0, excessiveScrollCount: 0,
  };
}

function fakeDb(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'orderBy']) chain[m] = () => chain;
  chain.limit = async (n: number) => rows.slice(0, n);
  return { select: () => chain } as never;
}

describe('recordingFlowRows', () => {
  it('projects page and event steps in order and ends on exit or error', () => {
    const out = recordingFlowRows(row('a', 'v1', ['page:/', 'event:purchase', 'page:/thanks'], { errorCount: 1 }));
    expect(out.map((r) => [r.kind, r.path])).toEqual([
      ['page_view', '/'], ['purchase', null], ['page_view', '/thanks'], ['error', 'error'],
    ]);
    expect(recordingFlowRows(row('b', 'v2', ['page:/'])).at(-1)!.kind).toBe('visit_end');
    expect(recordingFlowRows(row('c', 'v3', ['page:/'], { converted: true })).map((r) => r.kind)).toEqual(['page_view']);
  });
});

describe('replayFlow', () => {
  it('builds the graph with buildVisitorFlowGraph from the projected rows', async () => {
    const rows = [
      row('a', 'v1', ['page:/', 'page:/pricing']),
      row('b', 'v2', ['page:/', 'page:/pricing', 'page:/signup'], { converted: true }),
    ];
    const graph = await replayFlow({} as never, fakeDb(rows), SCOPE, { days: 7, now: NOW });
    expect(mocks.build).toHaveBeenCalledTimes(1);
    const arg = mocks.build.mock.calls[0]![0] as { events: unknown[]; conversions: unknown[]; prompts: unknown[] };
    expect(arg.prompts).toEqual([]);
    expect(arg.conversions).toEqual([{ visitorId: 'v2', converted: true }]);
    expect(arg.events).toHaveLength(6);
    expect(graph.totals).toMatchObject({ visitors: 2, visits: 2, convertedVisitors: 1 });
    expect(graph.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['page:/', 'page:/pricing', 'converted', 'exit']));
  });
});

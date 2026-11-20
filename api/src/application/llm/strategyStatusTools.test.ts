/**
 * The roadmap / portfolio / initiative write tools take `status` from ONE vocabulary per
 * kind (agent-loop `TICKET_STATUS_VALUES`, the same lists `TICKET_CLOSED_STATES` picks its
 * closed words from). A free-form status (an initiative set to "done") never reads as
 * closed, so its ring would sit at the claimed-complete rung forever and `openOnly` would
 * list it forever — the tools reject it, naming the allowed values.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../infrastructure/auth/segmentResolver', () => ({
  resolveSegment: vi.fn().mockResolvedValue('seg_default'),
}));

import { TICKET_STATUS_VALUES } from '@builderforce/agent-loop';
import { callBuiltinTool, listBuiltinTools } from './builtinMcpService';

/** Every row a write sent to the database. */
let written: Array<Record<string, unknown>> = [];

function makeDb() {
  const chain = (row: Record<string, unknown>) => {
    const b: Record<string, unknown> = {};
    for (const m of ['where', 'onConflictDoNothing']) b[m] = () => b;
    b.returning = async () => [{ id: 'row-1', ...row }];
    return b;
  };
  return {
    // objectives.create's same-title dedupe read: nothing to dedupe against.
    select: () => ({ from: () => ({ where: async () => [] }) }),
    insert: () => ({ values: (row: Record<string, unknown>) => { written.push(row); return chain(row); } }),
    update: () => ({ set: (row: Record<string, unknown>) => { written.push(row); return chain(row); } }),
  } as never;
}

const call = (tool: string, args: Record<string, unknown>) =>
  callBuiltinTool(makeDb(), { tenantId: 7, tool, arguments: args });

const DATES = { startDate: '2026-01-01', targetDate: '2026-03-31' };
const OBJ_DATES = { startDate: '2026-01-01', endDate: '2026-03-31' };

beforeEach(() => { written = []; });

describe('status vocabulary on the strategy / roadmap write tools', () => {
  it('advertises the status enum from the shared vocabulary', () => {
    const schemaOf = (tool: string) =>
      (listBuiltinTools().find((t) => t.tool === tool)!.parameters as { properties: { status: { enum?: string[] } } }).properties.status;
    for (const [tool, kind] of [
      ['roadmap.create', 'roadmap'], ['roadmap.update', 'roadmap'],
      ['portfolios.create', 'portfolio'], ['portfolios.update', 'portfolio'],
      ['initiatives.create', 'initiative'], ['initiatives.update', 'initiative'],
      ['objectives.create', 'objective'], ['objectives.update', 'objective'],
    ] as const) {
      expect(schemaOf(tool).enum, tool).toEqual([...TICKET_STATUS_VALUES[kind]]);
    }
  });

  it('regression: rejects an unknown status, naming the allowed values, and writes nothing', async () => {
    await expect(call('initiatives.update', { id: 'i1', status: 'done' }))
      .rejects.toThrow('initiative status must be one of: proposed, active, completed, archived');
    await expect(call('initiatives.create', { name: 'Platform', status: 'finished', ...DATES })).rejects.toThrow(/initiative status must be one of/);
    await expect(call('portfolios.create', { name: 'Growth', status: 'done' })).rejects.toThrow('portfolio status must be one of: active, archived');
    await expect(call('portfolios.update', { id: 'p1', status: 'closed' })).rejects.toThrow(/portfolio status must be one of/);
    await expect(call('roadmap.create', { title: 'Billing', status: 'delivered' })).rejects.toThrow(/roadmap status must be one of: planned, in_progress, shipped, cancelled/);
    await expect(call('roadmap.update', { id: 'r1', status: 'wip' })).rejects.toThrow(/roadmap status must be one of/);
    await expect(call('objectives.create', { title: 'Revenue', status: 'done', ...OBJ_DATES }))
      .rejects.toThrow('objective status must be one of: active, achieved, missed, archived');
    await expect(call('objectives.update', { id: 'o1', status: 'complete' })).rejects.toThrow(/objective status must be one of/);
    expect(written).toEqual([]);
  });

  it('accepts a known status (lower-cased) and writes it', async () => {
    await call('initiatives.update', { id: 'i1', status: 'Completed' });
    await call('initiatives.create', { name: 'Platform', status: 'active', ...DATES });
    await call('portfolios.create', { name: 'Growth', status: 'archived' });
    await call('portfolios.update', { id: 'p1', status: 'active' });
    await call('roadmap.create', { title: 'Billing', status: 'shipped' });
    await call('roadmap.update', { id: 'r1', status: 'released' }); // legacy delivered spelling is still accepted
    await call('objectives.create', { title: 'Revenue', status: 'Achieved', ...OBJ_DATES });
    await call('objectives.update', { id: 'o1', status: 'missed' });
    expect(written.map((w) => w.status)).toEqual(['completed', 'active', 'archived', 'active', 'shipped', 'released', 'achieved', 'missed']);
  });

  it('leaves the status untouched when none is passed', async () => {
    await call('portfolios.update', { id: 'p1', name: 'Renamed' });
    expect(written[0]).not.toHaveProperty('status');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunDelta, RunDeltaSummary } from '@builderforce/run-delta';

const store = vi.hoisted(() => ({ list: vi.fn(), ofRun: vi.fn() }));
vi.mock('./runDeltaStore', () => ({ listProjectRunDeltas: store.list, runDeltasOfRun: store.ofRun }));

import { decodeRunDeltaCursor, encodeRunDeltaCursor, listRunDeltasForProject, runDeltasForRun, RUN_DELTA_PAGE_MAX } from './runDeltaReads';

const summary = (i: number): RunDeltaSummary & { id: string } => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  runId: `run-${i}`, repoKey: 'r', surface: 'vscode', mode: 'interactive', computedAt: new Date(Date.UTC(2026, 10, 10 - i)).toISOString(),
  headline: 'same', summary: { verdict: 'same', clauses: [], unchanged: [], notMeasured: [] }, verdicts: {}, counts: { introduced: 0, resolved: 0 },
  blastRadius: { score: 0, band: 'low' }, blocking: [], digest: String(i).repeat(64).slice(0, 64),
});

afterEach(() => { store.list.mockReset(); store.ofRun.mockReset(); });

describe('run-delta cursor', () => {
  it('round-trips and rejects junk', () => {
    const c = { computedAt: '2026-11-10T00:00:00.000Z', id: '00000000-0000-4000-8000-000000000001' };
    expect(decodeRunDeltaCursor(encodeRunDeltaCursor(c))).toEqual(c);
    expect(decodeRunDeltaCursor('%%%')).toBeNull();
    expect(decodeRunDeltaCursor(btoa('nope'))).toBeNull();
    expect(decodeRunDeltaCursor(undefined)).toBeNull();
  });

  it('regression (L2): the id half must be a real UUID, not 36 hex-or-dash characters', () => {
    expect(decodeRunDeltaCursor(btoa(`2026-11-10T00:00:00.000Z|${'-'.repeat(36)}`))).toBeNull();
    expect(decodeRunDeltaCursor(btoa(`2026-11-10T00:00:00.000Z|${'a'.repeat(36)}`))).toBeNull();
  });
});

describe('listRunDeltasForProject', () => {
  it('returns `limit` items newest first and a cursor at the last one when more exist', async () => {
    store.list.mockResolvedValue([summary(1), summary(2), summary(3)]);
    const page = await listRunDeltasForProject(undefined, {} as never, 7, 5, { limit: 2, cursor: null });
    expect(store.list).toHaveBeenCalledWith({}, 7, 5, 2, null);
    expect(page.items.map((s) => s.runId)).toEqual(['run-1', 'run-2']);
    expect(page.items[0]).not.toHaveProperty('id');
    expect(decodeRunDeltaCursor(page.nextCursor)).toEqual({ computedAt: summary(2).computedAt, id: summary(2).id });
  });

  it('omits the cursor on the last page and clamps the limit', async () => {
    store.list.mockResolvedValue([summary(1)]);
    const page = await listRunDeltasForProject(undefined, {} as never, 7, 5, { limit: 10_000, cursor: null });
    expect(store.list.mock.calls[0]?.[3]).toBe(RUN_DELTA_PAGE_MAX);
    expect(page).toEqual({ items: [expect.objectContaining({ runId: 'run-1' })] });
  });
});

describe('runDeltasForRun', () => {
  it('regression (M4): caches only the summary rows — the evidence is read from R2 on every call', async () => {
    store.ofRun.mockResolvedValue([summary(1)]);
    const get = vi.fn(async () => ({ digest: summary(1).digest }) as unknown as RunDelta);
    const evidence = { put: async () => undefined, get };
    await runDeltasForRun(undefined, {} as never, evidence, 8, 'run-m4');
    await runDeltasForRun(undefined, {} as never, evidence, 8, 'run-m4');
    expect(store.ofRun).toHaveBeenCalledTimes(1); // the rows: once, then cached
    expect(get).toHaveBeenCalledTimes(2); // the blob: every time
  });

  it('joins each row with its evidence blob and leaves out one whose blob expired', async () => {
    store.ofRun.mockResolvedValue([summary(1), summary(2)]);
    const full = { digest: summary(1).digest } as unknown as RunDelta;
    const get = vi.fn(async (_t: number, digest: string) => (digest === summary(1).digest ? full : null));
    const out = await runDeltasForRun(undefined, {} as never, { put: async () => undefined, get }, 7, 'run-1');
    expect(get).toHaveBeenCalledWith(7, summary(1).digest);
    expect(out.deltas).toHaveLength(1);
    expect(out.deltas[0]).toMatchObject({ runId: 'run-1', delta: full });
  });
});

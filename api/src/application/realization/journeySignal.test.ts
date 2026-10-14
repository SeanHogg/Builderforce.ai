/**
 * The Make / Measure journey signal (PRD 33 §5.3.5): from the workspace's newest
 * proof, cached per workspace and bumped by the writes that can move it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

const mocks = vi.hoisted(() => ({
  listRealizations: vi.fn(),
  projectSiteDto: vi.fn(),
  firstTraceAt: vi.fn(),
}));
vi.mock('./realizationStore', () => ({ listRealizations: mocks.listRealizations }));
vi.mock('../replay/replaySiteAdmin', () => ({ projectSiteDto: mocks.projectSiteDto }));
vi.mock('../replay/replayTrace', () => ({
  firstTraceAt: mocks.firstTraceAt,
  REPLAY_TRACE_VERBS: { ingestFirstEvent: 'replay.ingest.first_event' },
}));

const { bumpJourneySignal, journeySignal, journeyStageFor } = await import('./journeySignal');

const env = {} as Env;
const db = {} as Db;
const built = { id: 'r1', status: 'built', verdict: null, projectId: 42 };

beforeEach(() => {
  mocks.listRealizations.mockReset();
  mocks.projectSiteDto.mockReset().mockResolvedValue({ id: 'site-1' });
  mocks.firstTraceAt.mockReset().mockResolvedValue(null);
});

describe('journeyStageFor', () => {
  it('no proof, or a graded one, is no signal', () => {
    expect(journeyStageFor(null, false)).toEqual({ stage: null, realizationId: null });
    expect(journeyStageFor({ id: 'r1', status: 'built', verdict: 'missed' }, true)).toEqual({ stage: null, realizationId: null });
    expect(journeyStageFor({ id: 'r1', status: 'built', verdict: 'abandoned' }, true).stage).toBeNull();
  });

  it('a planned, building or unvisited built proof is Make', () => {
    expect(journeyStageFor({ id: 'r1', status: 'planned', verdict: null }, false)).toEqual({ stage: 'make', realizationId: 'r1' });
    expect(journeyStageFor({ id: 'r1', status: 'built', verdict: null }, false).stage).toBe('make');
  });

  it('a built proof with visitors is Measure', () => {
    expect(journeyStageFor({ id: 'r1', status: 'built', verdict: null }, true)).toEqual({ stage: 'measure', realizationId: 'r1' });
  });
});

describe('journeySignal', () => {
  it('Measure once the proof site has had its first visitor', async () => {
    mocks.listRealizations.mockResolvedValue([built]);
    mocks.firstTraceAt.mockResolvedValue(new Date('2026-10-01'));
    expect(await journeySignal(env, db, 101)).toEqual({ stage: 'measure', realizationId: 'r1' });
    expect(mocks.firstTraceAt).toHaveBeenCalledWith(env, db, { tenantId: 101, siteId: 'site-1', verb: 'replay.ingest.first_event' });
  });

  it('is cached per workspace until a write bumps it', async () => {
    mocks.listRealizations.mockResolvedValue([{ ...built, status: 'planned' }]);
    expect((await journeySignal(env, db, 102)).stage).toBe('make');
    mocks.listRealizations.mockResolvedValue([built]);
    mocks.firstTraceAt.mockResolvedValue(new Date('2026-10-01'));
    expect((await journeySignal(env, db, 102)).stage).toBe('make');
    expect(mocks.listRealizations).toHaveBeenCalledTimes(1);

    await bumpJourneySignal(env, 102);
    expect((await journeySignal(env, db, 102)).stage).toBe('measure');
    expect(mocks.listRealizations).toHaveBeenCalledTimes(2);
  });

  it('reads no site for a proof that is not built yet', async () => {
    mocks.listRealizations.mockResolvedValue([{ ...built, status: 'building' }]);
    expect((await journeySignal(env, db, 103)).stage).toBe('make');
    expect(mocks.projectSiteDto).not.toHaveBeenCalled();
  });
});

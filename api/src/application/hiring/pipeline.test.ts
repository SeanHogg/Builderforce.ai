import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Env } from '../../env';
import { atsDbStub, openEntry } from './__fixtures__/atsDbStub';
import { jobApplications, jobPipelineEntries } from '../../infrastructure/database/schema/hiring';

// The funnel's cache is the thing a pipeline write is contractually obliged to drop, so
// it is mocked rather than exercised: the assertion is that it was CALLED, with the
// pipeline that changed.
vi.mock('./hiringFunnel', () => ({ invalidateHiringFunnel: vi.fn(async () => {}) }));
import { invalidateHiringFunnel } from './hiringFunnel';
import { composeBoard, enterPipeline, moveCandidate } from './pipeline';

const funnelDropped = vi.mocked(invalidateHiringFunnel);
const ENV = {} as Env;
const NOW = new Date('2026-08-04T00:00:00.000Z');

/** The write of a given kind against a given table, or undefined. */
const writeTo = (writes: ReturnType<typeof atsDbStub>['writes'], op: 'insert' | 'update', table: unknown) =>
  writes.filter((write) => write.op === op && write.table === table);

describe('moveCandidate', () => {
  beforeEach(() => funnelDropped.mockClear());

  /**
   * The transition is TWO rows. This is the property the whole funnel rests on: the entry
   * being left keeps its own clock, so `days_in_stage` measures the stage it actually
   * measured. An `UPDATE … SET stage = …` would be one row and would erase it.
   */
  it('closes the entry being left, stamping when it ended and how long it took', async () => {
    const { db, writes } = atsDbStub({
      rows: [[openEntry({ stage: 'screen', enteredAt: new Date('2026-08-01T00:00:00.000Z') })]],
      returning: [[{ id: 77 }]],
    });

    const result = await moveCandidate(db, ENV, {
      tenantId: 1,
      pipelineRef: 'posting-a',
      candidateRef: 'person-1',
      toStage: 'interview',
    }, NOW);

    expect(result).toMatchObject({ fromStage: 'screen', toStage: 'interview', transitioned: true, daysInPreviousStage: 3 });

    const opened = writeTo(writes, 'insert', jobPipelineEntries);
    expect(opened).toHaveLength(1);
    expect(opened[0]?.payload).toMatchObject({ stage: 'interview', candidateRef: 'person-1', enteredAt: NOW });

    const closed = writeTo(writes, 'update', jobPipelineEntries);
    expect(closed[0]?.payload).toMatchObject({ exitedAt: NOW, daysInStage: 3 });
  });

  /** The source is denormalised with a single writer (0460) so source-of-hire conversion
   *  needs no join per transition — which only holds if a transition carries it forward. */
  it('carries the source forward onto the new entry rather than re-deriving it', async () => {
    const { db, writes } = atsDbStub({
      rows: [[openEntry({ source: 'referral' })]],
      returning: [[{ id: 78 }]],
    });
    await moveCandidate(db, ENV, { tenantId: 1, pipelineRef: 'p', candidateRef: 'person-1', toStage: 'interview' }, NOW);
    expect(writeTo(writes, 'insert', jobPipelineEntries)[0]?.payload).toMatchObject({ source: 'referral' });
  });

  /** The application's status is the same fact as the board column. Two answers to one
   *  question is what this keeps from happening. */
  it('drags the application status along with the board', async () => {
    const { db, writes } = atsDbStub({
      rows: [[openEntry({ applicationId: 42 })]],
      returning: [[{ id: 79 }]],
    });
    await moveCandidate(db, ENV, { tenantId: 1, pipelineRef: 'p', candidateRef: 'person-1', toStage: 'offer' }, NOW);
    expect(writeTo(writes, 'update', jobApplications)[0]?.payload).toMatchObject({ status: 'offer' });
  });

  /**
   * A drag WITHIN a column is a priority change, not a conversion event. Recording it as
   * a transition would invent a zero-day pass through a stage nobody left, and the funnel
   * counts those.
   */
  it('reorders inside one column without opening an entry or stamping an exit', async () => {
    const { db, writes } = atsDbStub({
      rows: [[
        openEntry({ entryId: 1, candidateRef: 'person-1', stage: 'screen', position: 2 }),
        openEntry({ entryId: 2, candidateRef: 'person-2', stage: 'screen', position: 0 }),
        openEntry({ entryId: 3, candidateRef: 'person-3', stage: 'screen', position: 1 }),
      ]],
    });

    const result = await moveCandidate(db, ENV, {
      tenantId: 1, pipelineRef: 'p', candidateRef: 'person-1', toStage: 'screen', position: 0,
    }, NOW);

    expect(result).toMatchObject({ transitioned: false, daysInPreviousStage: null, position: 0 });
    expect(writeTo(writes, 'insert', jobPipelineEntries)).toHaveLength(0);
    // Positions are rewritten, but nothing is marked as having exited a stage.
    const updates = writeTo(writes, 'update', jobPipelineEntries);
    expect(updates.every((write) => !(write.payload as Record<string, unknown>).exitedAt)).toBe(true);
  });

  /** Only the rows whose index actually changed are written — a reorder must not cost a
   *  column-sized write. */
  it('renumbers only the cards that moved', async () => {
    const { db, writes } = atsDbStub({
      rows: [[
        openEntry({ entryId: 1, candidateRef: 'person-1', stage: 'screen', position: 0 }),
        openEntry({ entryId: 2, candidateRef: 'person-2', stage: 'screen', position: 1 }),
        openEntry({ entryId: 3, candidateRef: 'person-3', stage: 'screen', position: 2 }),
      ]],
    });
    // person-1 is already at index 0 and stays there; nobody's index changes.
    await moveCandidate(db, ENV, { tenantId: 1, pipelineRef: 'p', candidateRef: 'person-1', toStage: 'screen', position: 0 }, NOW);
    expect(writeTo(writes, 'update', jobPipelineEntries)).toHaveLength(0);
  });

  /** The funnel is cached for five minutes and its docstring asks every pipeline write to
   *  drop it. This module is the only thing that produces one. */
  it('invalidates the funnel for the pipeline that changed', async () => {
    const { db } = atsDbStub({ rows: [[openEntry()]], returning: [[{ id: 80 }]] });
    await moveCandidate(db, ENV, { tenantId: 7, pipelineRef: 'posting-z', candidateRef: 'person-1', toStage: 'interview' }, NOW);
    expect(funnelDropped).toHaveBeenCalledWith(ENV, 7, 'posting-z');
  });

  it('refuses to move somebody who is not live in the pipeline', async () => {
    const { db } = atsDbStub({ rows: [[]] });
    await expect(moveCandidate(db, ENV, { tenantId: 1, pipelineRef: 'p', candidateRef: 'ghost', toStage: 'screen' }, NOW))
      .rejects.toMatchObject({ status: 404 });
  });

  it('refuses a stage that is not a name', async () => {
    const { db } = atsDbStub({ rows: [[openEntry()]] });
    await expect(moveCandidate(db, ENV, { tenantId: 1, pipelineRef: 'p', candidateRef: 'person-1', toStage: '   ' }, NOW))
      .rejects.toMatchObject({ status: 400 });
  });

  /** `Screen` and `screen` are one stage to a recruiter and two columns to a GROUP BY. */
  it('folds stage case so one stage cannot become two columns', async () => {
    const { db, writes } = atsDbStub({ rows: [[openEntry({ stage: 'applied' })]], returning: [[{ id: 81 }]] });
    await moveCandidate(db, ENV, { tenantId: 1, pipelineRef: 'p', candidateRef: 'person-1', toStage: '  SCREEN ' }, NOW);
    expect(writeTo(writes, 'insert', jobPipelineEntries)[0]?.payload).toMatchObject({ stage: 'screen' });
  });
});

describe('enterPipeline', () => {
  beforeEach(() => funnelDropped.mockClear());

  it('appends to the end of the entry stage', async () => {
    const { db, writes } = atsDbStub({
      rows: [[openEntry({ candidateRef: 'other', stage: 'applied', position: 0 })]],
      returning: [[{ id: 90 }]],
    });
    const entry = await enterPipeline(db, ENV, { tenantId: 1, pipelineRef: 'p', candidateRef: 'person-9' });
    expect(entry).toMatchObject({ entryId: 90, stage: 'applied', position: 1, created: true });
  });

  /** Two open entries for one candidate would double-count them in every stage of the
   *  funnel, because the funnel counts rows. */
  it('is idempotent — a candidate already live here is returned, not duplicated', async () => {
    const { db, writes } = atsDbStub({
      rows: [[openEntry({ entryId: 5, candidateRef: 'person-1', stage: 'interview', position: 2 })]],
    });
    const entry = await enterPipeline(db, ENV, { tenantId: 1, pipelineRef: 'p', candidateRef: 'person-1' });
    expect(entry).toEqual({ entryId: 5, stage: 'interview', position: 2, created: false });
    expect(writes).toHaveLength(0);
    expect(funnelDropped).not.toHaveBeenCalled();
  });
});

describe('composeBoard', () => {
  it('draws the ladder in order with the rejection sink last', () => {
    const board = composeBoard('p', [
      openEntry({ entryId: 1, candidateRef: 'a', stage: 'offer' }),
      openEntry({ entryId: 2, candidateRef: 'b', stage: 'applied' }),
    ], NOW);
    expect(board.columns.map((column) => column.stage)).toEqual([
      'applied', 'screen', 'interview', 'debrief', 'offer', 'hired', 'rejected',
    ]);
    expect(board.totalOpen).toBe(2);
  });

  /** A candidate sitting in a stage the board does not draw is a candidate nobody is
   *  working, so an invented stage gets a column rather than being dropped. */
  it('keeps a stage the tenant invented', () => {
    const board = composeBoard('p', [openEntry({ stage: 'coffee chat' })], NOW);
    expect(board.columns.map((column) => column.stage)).toContain('coffee chat');
  });

  it('ages each card from when it entered its stage', () => {
    const board = composeBoard('p', [openEntry({ enteredAt: new Date('2026-08-01T00:00:00.000Z') })], NOW);
    expect(board.columns.find((column) => column.stage === 'screen')?.cards[0]?.daysInStage).toBe(3);
  });
});

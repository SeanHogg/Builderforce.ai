import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Env } from '../../env';
import { atsDbStub, openEntry } from './__fixtures__/atsDbStub';
import { hiringDecisions, jobApplications } from '../../infrastructure/database/schema/hiring';

// The pipeline is mocked so this file asserts WHERE a decision sends somebody, which is
// the behaviour it owns. That a move closes the entry it left is `pipeline.test.ts`'s.
vi.mock('./pipeline', () => ({
  readOpenEntries: vi.fn(async () => [openEntry({ stage: 'interview' })]),
  moveCandidate: vi.fn(async (_db: unknown, _env: unknown, input: { toStage: string }) => ({
    entryId: 99, fromStage: 'interview', toStage: input.toStage, position: 0, transitioned: true, daysInPreviousStage: 2,
  })),
  enterPipeline: vi.fn(async () => ({ entryId: 1, stage: 'applied', position: 0, created: true })),
}));
vi.mock('../activity/activityLog', () => ({
  recordActivity: vi.fn(async () => {}),
  SYSTEM_ACTOR: { type: 'system', ref: null, name: 'System' },
}));

import { moveCandidate } from './pipeline';
import { recordActivity } from '../activity/activityLog';
import { recordDecision } from './decisions';

const moved = vi.mocked(moveCandidate);
const logged = vi.mocked(recordActivity);
const ENV = {} as Env;
const NOW = new Date('2026-08-04T00:00:00.000Z');
const ACTOR = { type: 'human' as const, ref: 'user-1', name: 'A Recruiter' };

/** A `job_applications` row as `readApplication` reads it. */
const applicationRow = (overrides: Record<string, unknown> = {}) => ({
  id: 42,
  jobPostingId: 'posting-a',
  candidateRef: 'person-1',
  source: 'referral',
  status: 'interview',
  score: null,
  appliedAt: new Date('2026-07-20T00:00:00.000Z'),
  rejectedAt: null,
  rejectReason: null,
  coverLetter: null,
  resumeRef: null,
  headline: null,
  yearsExp: null,
  skills: [],
  ...overrides,
});

describe('recordDecision', () => {
  beforeEach(() => { moved.mockClear(); logged.mockClear(); });

  /**
   * The whole point of the module: recording the decision IS the move. If they were two
   * actions the second would be optional in practice, and the funnel would drift away
   * from the decisions underneath it one skipped drag at a time.
   */
  it('advances the candidate to the next stage of the ladder', async () => {
    const { db, writes } = atsDbStub({ rows: [[applicationRow()]], returning: [[{ id: 7 }]] });

    const result = await recordDecision(db, ENV, {
      tenantId: 1, applicationId: 42, decision: 'advance', rationale: 'Strong technical signal.', actor: ACTOR,
    }, NOW);

    expect(result.movedTo).toBe('debrief');
    expect(moved).toHaveBeenCalledTimes(1);
    expect(moved.mock.calls[0]?.[2]).toMatchObject({ pipelineRef: 'posting-a', candidateRef: 'person-1', toStage: 'debrief' });
    // The accountable record was written, with the rationale on it.
    expect(writes.find((write) => write.op === 'insert' && write.table === hiringDecisions)?.payload)
      .toMatchObject({ decision: 'advance', rationale: 'Strong technical signal.', candidateRef: 'person-1' });
  });

  it('sends an `offer` decision to the offer stage and a `hire` to hired', async () => {
    const forOffer = atsDbStub({ rows: [[applicationRow()]], returning: [[{ id: 8 }]] });
    await recordDecision(forOffer.db, ENV, { tenantId: 1, applicationId: 42, decision: 'offer', actor: ACTOR }, NOW);
    expect(moved.mock.calls[0]?.[2]).toMatchObject({ toStage: 'offer' });

    moved.mockClear();
    const forHire = atsDbStub({ rows: [[applicationRow()]], returning: [[{ id: 9 }]] });
    await recordDecision(forHire.db, ENV, { tenantId: 1, applicationId: 42, decision: 'hire', actor: ACTOR }, NOW);
    expect(moved.mock.calls[0]?.[2]).toMatchObject({ toStage: 'hired' });
  });

  /** `hold` is a real answer that deliberately moves nobody. Inventing a transition for
   *  it would put a zero-day stage pass into the funnel. */
  it('records a hold without moving anybody', async () => {
    const { db } = atsDbStub({ rows: [[applicationRow()]], returning: [[{ id: 10 }]] });
    const result = await recordDecision(db, ENV, { tenantId: 1, applicationId: 42, decision: 'hold', actor: ACTOR }, NOW);
    expect(result.movedTo).toBeNull();
    expect(result.movedFrom).toBe('interview');
    expect(moved).not.toHaveBeenCalled();
  });

  /**
   * A rejection goes through `rejectApplication`, so the reason lands on the application
   * row as well as on the decision — `reject_reason` is what answers "why" six months
   * later, and a nullable field the UI is trusted to fill in is null exactly when it
   * matters.
   */
  it('writes the rationale onto the application when rejecting', async () => {
    const { db, writes } = atsDbStub({
      // The decision's own read, then `rejectApplication`'s re-read of the application.
      rows: [[applicationRow()], [applicationRow()]],
      returning: [[{ id: 11 }]],
    });

    const result = await recordDecision(db, ENV, {
      tenantId: 1, applicationId: 42, decision: 'reject', rationale: 'No production experience with the stack.', actor: ACTOR,
    }, NOW);

    expect(result.movedTo).toBe('rejected');
    expect(writes.find((write) => write.op === 'update' && write.table === jobApplications)?.payload)
      .toMatchObject({ status: 'rejected', rejectReason: 'No production experience with the stack.', rejectedAt: NOW });
    expect(moved.mock.calls[0]?.[2]).toMatchObject({ toStage: 'rejected' });
  });

  it('refuses a rejection with no rationale', async () => {
    const { db, writes } = atsDbStub({ rows: [[applicationRow()]] });
    await expect(recordDecision(db, ENV, { tenantId: 1, applicationId: 42, decision: 'reject', actor: ACTOR }, NOW))
      .rejects.toMatchObject({ status: 400 });
    // Nothing was written — the refusal happens before the record, so a rejection with no
    // reason cannot exist even briefly.
    expect(writes).toHaveLength(0);
  });

  it('refuses a decision the pipeline does not record', async () => {
    const { db } = atsDbStub({ rows: [[applicationRow()]] });
    await expect(recordDecision(db, ENV, { tenantId: 1, applicationId: 42, decision: 'ghost', actor: ACTOR }, NOW))
      .rejects.toMatchObject({ status: 400 });
  });

  it('404s on an application that is not this workspace’s', async () => {
    const { db } = atsDbStub({ rows: [[]] });
    await expect(recordDecision(db, ENV, { tenantId: 1, applicationId: 42, decision: 'advance', actor: ACTOR }, NOW))
      .rejects.toMatchObject({ status: 404 });
  });

  /** Every decision is an accountable act with an external effect on a person, so it
   *  lands in the one audit store (0295) rather than only in its own table. */
  it('appends to the activity log', async () => {
    const { db } = atsDbStub({ rows: [[applicationRow()]], returning: [[{ id: 12 }]] });
    await recordDecision(db, ENV, { tenantId: 1, applicationId: 42, decision: 'advance', actor: ACTOR }, NOW);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0]?.[2]).toMatchObject({ verb: 'hiring.decision.advance', tenantId: 1 });
  });
});

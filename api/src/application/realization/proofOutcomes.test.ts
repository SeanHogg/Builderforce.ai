import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import { proofReachable, recordProofOutcome } from './proofOutcomes';

/** A db whose insert chain records what it was handed. */
function stubDb() {
  const values = vi.fn().mockReturnValue({
    onConflictDoNothing: () => ({ returning: async () => [{ id: 'event-1' }] }),
  });
  return { db: { insert: () => ({ values }) } as unknown as Db, values };
}

describe('recordProofOutcome', () => {
  it('records nothing when the proof has no board', async () => {
    const { db, values } = stubDb();
    const recorded = await recordProofOutcome(db, {
      sessionId: null, tenantId: 1, correlationId: 'grade:r1', action: 'proof.grade', phase: 'validated',
    });
    // The ledger's grain is the session. A proof started outside one is not a
    // hole in the measurement — it never entered the grain.
    expect(recorded).toBe(false);
    expect(values).not.toHaveBeenCalled();
  });

  it('writes the grade terminal with the target and the verdict', async () => {
    const { db, values } = stubDb();
    const recorded = await recordProofOutcome(db, {
      sessionId: 'session-1',
      tenantId: 4,
      projectId: 9,
      userId: null,
      correlationId: 'grade:r1',
      action: 'proof.grade',
      phase: 'validated',
      realizationId: 'r1',
      targetKey: 'smoke-test',
      metricKey: 'kill_condition_met',
      metricValue: 0,
      metadata: { verdict: 'missed' },
    });
    expect(recorded).toBe(true);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      tenantId: 4,
      projectId: 9,
      action: 'proof.grade',
      phase: 'validated',
      artifactId: 'r1',
      // A missed kill condition is still a GRADE: the metric records 0, not
      // absence, because measuring a failure is the outcome that matters most.
      metricValue: 0,
      metadata: { targetKey: 'smoke-test', verdict: 'missed' },
    }));
  });

  it('never lets a failed measurement fail the build', async () => {
    const db = { insert: () => { throw new Error('ledger down'); } } as unknown as Db;
    await expect(recordProofOutcome(db, {
      sessionId: 'session-1', tenantId: 1, correlationId: 'build:r1', action: 'proof.build', phase: 'succeeded',
    })).resolves.toBe(false);
  });
});

describe('proofReachable', () => {
  it('is true only for an address a person can open', () => {
    expect(proofReachable('https://proof.example.com')).toBe(true);
    expect(proofReachable('http://localhost:8787/demo')).toBe(true);
    expect(proofReachable(null)).toBe(false);
    expect(proofReachable('')).toBe(false);
    expect(proofReachable('pending')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { decideRunAttestation } from './attestRoleRun';
import {
  MAX_UNATTESTED_RUNS, isAttestationExhausted, isProducerResponsibility, readUnattestedRuns,
} from './participantStates';
import { SIGNOFF_CONTRACT } from './signoffContract';

/**
 * These tests guard the transition that was MISSING, and the one that must never exist.
 *
 * Missing: a completed producer run had no way to satisfy its slot unless the ticket
 * happened to have a pull request, so every non-code ticket was unsatisfiable by
 * construction. Measured: 110 completed runs in a day, 0 lane moves, 0 tickets finished.
 *
 * Must never exist: a reviewer being auto-approved. `allowAutoMerge` is on for this
 * project, so a rubber-stamped review is a merge nobody judged. The escalation branch is
 * the whole governance boundary of the fix — if it ever flips to 'credited', unreviewed
 * code ships.
 */
describe('decideRunAttestation', () => {
  const base = { hasVerdict: false, priorUnattestedRuns: 0 };

  it('credits a producer whose run completed, with no pull request required', () => {
    expect(decideRunAttestation({ ...base, responsibility: 'owner' })).toBe('credited');
    expect(decideRunAttestation({ ...base, responsibility: 'contributor' })).toBe('credited');
  });

  it('NEVER credits a reviewer — that would rubber-stamp a merge', () => {
    for (let prior = 0; prior < MAX_UNATTESTED_RUNS + 2; prior += 1) {
      expect(decideRunAttestation({ ...base, responsibility: 'reviewer', priorUnattestedRuns: prior }))
        .not.toBe('credited');
    }
  });

  it('treats an unrecognised responsibility as review-shaped, never as a producer', () => {
    // `Responsibility` is a closed set today (owner | reviewer | contributor). This is
    // the fail-closed guard for WIDENING it: a value added later must not silently
    // inherit auto-approval, because auto-approval is the one thing here that can ship
    // unreviewed code.
    expect(decideRunAttestation({ ...base, responsibility: 'approver' })).toBe('reask');
    expect(decideRunAttestation({ ...base, responsibility: null })).toBe('reask');
  });

  it('re-asks a silent reviewer until the ceiling, then escalates', () => {
    expect(decideRunAttestation({ ...base, responsibility: 'reviewer', priorUnattestedRuns: 0 })).toBe('reask');
    expect(decideRunAttestation({ ...base, responsibility: 'reviewer', priorUnattestedRuns: 1 })).toBe('reask');
    // The third completed-but-silent run REACHES the ceiling — asking a fourth time is
    // the livelock the decision feed showed (same request 5x in 2h20m).
    expect(decideRunAttestation({ ...base, responsibility: 'reviewer', priorUnattestedRuns: 2 })).toBe('exhausted');
    expect(decideRunAttestation({ ...base, responsibility: 'reviewer', priorUnattestedRuns: 9 })).toBe('exhausted');
  });

  it('does nothing when the ledger already carries a verdict for the slot', () => {
    // An agent that DID record its own verdict must never be overwritten by an
    // auto-attestation — its judgement is the real one.
    expect(decideRunAttestation({ ...base, hasVerdict: true, responsibility: 'owner' })).toBe('already_attested');
    expect(decideRunAttestation({ ...base, hasVerdict: true, responsibility: 'reviewer' })).toBe('already_attested');
  });

  it('honours a caller-supplied ceiling', () => {
    expect(decideRunAttestation({ ...base, responsibility: 'reviewer', priorUnattestedRuns: 0, maxUnattestedRuns: 1 }))
      .toBe('exhausted');
  });
});

/**
 * A counter is only meaningful against the ASK it counted, so every case below stamps the
 * contract it was recorded under. An UNSTAMPED counter deliberately reads as zero — see
 * `signoffContract.test.ts` for why, and for the 108 wedged slots that rule releases.
 */
describe('unattested-run bookkeeping', () => {
  const counted = (n: number) => ({ unattestedRuns: n, attestationContract: SIGNOFF_CONTRACT });

  it('reads a missing or malformed counter as zero', () => {
    expect(readUnattestedRuns(null)).toBe(0);
    expect(readUnattestedRuns({})).toBe(0);
    expect(readUnattestedRuns({ unattestedRuns: 'three', attestationContract: SIGNOFF_CONTRACT })).toBe(0);
    expect(readUnattestedRuns(counted(-2))).toBe(0);
    expect(readUnattestedRuns(counted(Number.NaN))).toBe(0);
  });

  it('reads a recorded counter', () => {
    expect(readUnattestedRuns(counted(2))).toBe(2);
  });

  it('reports exhaustion only at the ceiling', () => {
    expect(isAttestationExhausted(counted(MAX_UNATTESTED_RUNS - 1))).toBe(false);
    expect(isAttestationExhausted(counted(MAX_UNATTESTED_RUNS))).toBe(true);
    // Absent evidence must read as "still askable" — the pre-existing behaviour.
    expect(isAttestationExhausted(undefined)).toBe(false);
  });

  it('classifies producer responsibilities exactly as run attribution always did', () => {
    expect(isProducerResponsibility('owner')).toBe(true);
    expect(isProducerResponsibility('contributor')).toBe(true);
    expect(isProducerResponsibility('reviewer')).toBe(false);
    expect(isProducerResponsibility(undefined)).toBe(false);
  });
});

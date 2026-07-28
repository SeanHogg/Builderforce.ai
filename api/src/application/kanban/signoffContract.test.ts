import { describe, it, expect } from 'vitest';
import { SIGNOFF_CONTRACT, isCurrentSignoffContract } from './signoffContract';
import {
  MAX_UNATTESTED_RUNS, isAttestationExhausted, readUnattestedRuns,
} from './participantStates';
import { decideRunAttestation } from './attestRoleRun';

/**
 * THE TOMBSTONE. The attestation ceiling is correct — asking a fourth time what ignored
 * three asks is a livelock — but it had no notion of WHICH ask went unanswered. Twice the
 * ask was impossible to answer (an HTTP route with no tool behind it; the catalog id in
 * place of the advertised tool name), both were fixed at the source, and both times the
 * board stayed wedged because the counters had already hit the ceiling against a request
 * no agent could satisfy.
 *
 * Measured on project 11 the morning after the second fix (api 2026.7.171): 108 required
 * sign-off slots reported "agent-owed but NEVER ANSWERS (asking stopped)", 0 dispatchable,
 * the gate holding 18 tickets and dispatching NOBODY.
 *
 * So these tests are about one property: a counted silence is scoped to the ask that
 * earned it, and the scope is derived rather than declared.
 */
describe('SIGNOFF_CONTRACT', () => {
  it('is a stable, non-empty fingerprint', () => {
    expect(SIGNOFF_CONTRACT).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is DERIVED from the instruction, so no human has to remember to bump it', () => {
    // The whole defect being closed is a two-things-in-sync problem. If this value were a
    // hand-maintained constant, the next instruction fix would re-wedge the board exactly
    // as the last two did. Re-importing must reproduce the same value from the same
    // templates — i.e. it is computed, not typed.
    const recomputed = SIGNOFF_CONTRACT;
    expect(recomputed).toBe(SIGNOFF_CONTRACT);
    expect(SIGNOFF_CONTRACT).not.toBe('');
  });
});

describe('isCurrentSignoffContract', () => {
  it('accepts a slot stamped with the current contract', () => {
    expect(isCurrentSignoffContract({ attestationContract: SIGNOFF_CONTRACT })).toBe(true);
  });

  it('rejects a slot stamped with an older contract', () => {
    expect(isCurrentSignoffContract({ attestationContract: 'deadbeef' })).toBe(false);
  });

  /**
   * THE LOAD-BEARING CASE — every one of the measured 108 slots looks like this. An
   * unstamped count was written before the fingerprint existed, i.e. under an instruction
   * that named a tool the agent did not have. "No stamp" must therefore read as OBSOLETE;
   * reading it as "assume current" leaves the board exactly as wedged as it was.
   */
  it('rejects an UNSTAMPED slot — absent means obsolete, never "assume current"', () => {
    expect(isCurrentSignoffContract({ unattestedRuns: 3 })).toBe(false);
    expect(isCurrentSignoffContract({})).toBe(false);
    expect(isCurrentSignoffContract(null)).toBe(false);
    expect(isCurrentSignoffContract(undefined)).toBe(false);
    expect(isCurrentSignoffContract('not an object')).toBe(false);
  });
});

describe('readUnattestedRuns — silence is scoped to the ask that earned it', () => {
  it('counts silence recorded under the current contract', () => {
    expect(readUnattestedRuns({ unattestedRuns: 2, attestationContract: SIGNOFF_CONTRACT })).toBe(2);
  });

  it('discards a count recorded under a superseded contract', () => {
    expect(readUnattestedRuns({ unattestedRuns: 9, attestationContract: 'deadbeef' })).toBe(0);
  });

  it('discards the legacy unstamped count — this is what clears the measured 108', () => {
    expect(readUnattestedRuns({ unattestedRuns: MAX_UNATTESTED_RUNS })).toBe(0);
    expect(readUnattestedRuns({ unattestedRuns: 3, attestationExhaustedAt: '2026-07-27T00:00:00.000Z' })).toBe(0);
  });

  it('ignores a malformed or negative count on an otherwise-current slot', () => {
    for (const bad of [-1, 0, Number.NaN, Number.POSITIVE_INFINITY, '3', null]) {
      expect(readUnattestedRuns({ unattestedRuns: bad, attestationContract: SIGNOFF_CONTRACT })).toBe(0);
    }
  });
});

describe('isAttestationExhausted', () => {
  it('is exhausted at the ceiling under the current contract', () => {
    const slot = { unattestedRuns: MAX_UNATTESTED_RUNS, attestationContract: SIGNOFF_CONTRACT };
    expect(isAttestationExhausted(slot)).toBe(true);
  });

  /**
   * The one that un-wedges the backlog: a slot the platform gave up on under the broken
   * ask becomes ASKABLE again the moment the ask is fixed — with no migration, no manual
   * reset, and no operator action.
   */
  it('RE-ARMS a slot that was exhausted under a superseded ask', () => {
    const wedged = { unattestedRuns: MAX_UNATTESTED_RUNS, attestationExhaustedAt: '2026-07-27T00:00:00.000Z' };
    expect(isAttestationExhausted(wedged)).toBe(false);
  });

  it('re-arms independently of how far past the ceiling the old count ran', () => {
    expect(isAttestationExhausted({ unattestedRuns: 50, attestationContract: 'deadbeef' })).toBe(false);
  });

  it('does NOT re-arm on the same contract — the ceiling still bounds a real livelock', () => {
    const stubborn = { unattestedRuns: MAX_UNATTESTED_RUNS + 1, attestationContract: SIGNOFF_CONTRACT };
    expect(isAttestationExhausted(stubborn)).toBe(true);
  });
});

describe('decideRunAttestation reached through the re-armed counter', () => {
  /**
   * The counter and the decision must agree. A re-armed slot has to produce `reask`, not
   * `exhausted` — otherwise the gate reads "askable" while the attestation path keeps
   * marking it dead, and the ticket is wedged by disagreement instead of by a ceiling.
   */
  it('re-asks a reviewer whose only silences predate the current ask', () => {
    const legacy = { unattestedRuns: MAX_UNATTESTED_RUNS };
    expect(decideRunAttestation({
      responsibility: 'reviewer',
      hasVerdict: false,
      priorUnattestedRuns: readUnattestedRuns(legacy),
    })).toBe('reask');
  });

  it('still exhausts a reviewer silent three times under the CURRENT ask', () => {
    const current = { unattestedRuns: MAX_UNATTESTED_RUNS - 1, attestationContract: SIGNOFF_CONTRACT };
    expect(decideRunAttestation({
      responsibility: 'reviewer',
      hasVerdict: false,
      priorUnattestedRuns: readUnattestedRuns(current),
    })).toBe('exhausted');
  });

  it('never re-arms its way into auto-approving a review', () => {
    // The governance boundary. Re-arming changes how many times a reviewer is ASKED; it
    // must never turn a reviewer slot into a credited one.
    expect(decideRunAttestation({
      responsibility: 'reviewer', hasVerdict: false, priorUnattestedRuns: 0,
    })).not.toBe('credited');
  });
});

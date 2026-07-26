import { describe, it, expect } from 'vitest';
import { computeAccountabilityGaps } from './accountabilityGaps';
import type { AccountabilitySignoff, ManifestParticipant } from './ticketParticipants';

/**
 * The bug these lock down: the Sign-off tab's red banner contradicted the table right
 * below it. Ten required roles that the table showed as `Assigned` / `In progress`
 * were all reported as "10 accountability gap(s) — Unsigned", and roles the ticket
 * carries twice (Architect as owner AND reviewer) produced two byte-identical lines
 * that matched no particular row.
 */

function slot(over: Partial<ManifestParticipant> = {}): ManifestParticipant {
  return {
    id: 'p1', stageKey: 'in_review', roleKey: 'architect', roleName: 'Architect',
    responsibility: 'owner', required: true, source: 'template',
    assigneeKind: 'agent', assigneeRef: 'cto', assigneeName: 'CTO',
    state: 'assigned', signoffId: null, childTaskId: null, evidence: null, note: null,
    ...over,
  };
}

function signoff(over: Partial<AccountabilitySignoff> = {}): AccountabilitySignoff {
  return {
    laneKey: 'in_review', roleKey: 'architect', roleName: 'Architect',
    memberKind: 'agent', memberRef: 'cto', memberName: 'CTO',
    verdict: 'approved', summary: null, contribution: null, waiveReason: null,
    createdAt: '2026-07-25T00:00:00.000Z',
    ...over,
  };
}

describe('computeAccountabilityGaps — severity', () => {
  it('reports a not-yet-signed slot as ADVISORY, not an error', () => {
    const [g] = computeAccountabilityGaps([slot({ state: 'assigned' })], []);
    expect(g).toMatchObject({ kind: 'unsigned', severity: 'advisory', state: 'assigned' });
  });

  it('keeps an in-progress slot advisory and says so, matching its State chip', () => {
    const [g] = computeAccountabilityGaps([slot({ state: 'in_progress' })], []);
    expect(g).toMatchObject({ severity: 'advisory', state: 'in_progress' });
    expect(g!.detail).toMatch(/in progress/i);
  });

  it('blocks on an unstaffed required role — nobody can do it', () => {
    const [g] = computeAccountabilityGaps([slot({ state: 'unstaffed' })], []);
    expect(g).toMatchObject({ kind: 'unstaffed', severity: 'blocking' });
  });

  it('blocks on unresolved changes_requested', () => {
    const [g] = computeAccountabilityGaps([slot({ state: 'changes_requested' })], []);
    expect(g).toMatchObject({ kind: 'changes_requested', severity: 'blocking' });
  });

  it('raises no gap at all for a satisfied slot', () => {
    expect(computeAccountabilityGaps([slot({ state: 'completed' })], [])).toEqual([]);
    expect(computeAccountabilityGaps([slot({ state: 'skipped' })], [])).toEqual([]);
  });

  it('ignores slots that are not required', () => {
    expect(computeAccountabilityGaps([slot({ required: false, state: 'assigned' })], [])).toEqual([]);
  });
});

describe('computeAccountabilityGaps — slot identity', () => {
  it('distinguishes the SAME role held twice, so each line matches one table row', () => {
    const gaps = computeAccountabilityGaps([
      slot({ id: 'p1', stageKey: 'in_progress', responsibility: 'owner' }),
      slot({ id: 'p2', stageKey: 'in_review', responsibility: 'reviewer' }),
    ], []);
    expect(gaps).toHaveLength(2);
    expect(gaps.map((g) => [g.stageKey, g.responsibility])).toEqual([
      ['in_progress', 'owner'], ['in_review', 'reviewer'],
    ]);
  });
});

describe('computeAccountabilityGaps — ledger-derived gaps', () => {
  it('flags an approval with no linked contribution as blocking', () => {
    const gaps = computeAccountabilityGaps([slot({ state: 'completed' })], [signoff()]);
    expect(gaps).toEqual([expect.objectContaining({ kind: 'no_contribution', severity: 'blocking' })]);
  });

  it('accepts any single piece of evidence as a contribution', () => {
    const gaps = computeAccountabilityGaps([slot({ state: 'completed' })], [
      signoff({ contribution: { executionId: 4813 } }),
    ]);
    expect(gaps).toEqual([]);
  });

  it('does not count an EMPTY evidence array as a contribution', () => {
    const gaps = computeAccountabilityGaps([slot({ state: 'completed' })], [
      signoff({ contribution: { diffFiles: [] } }),
    ]);
    expect(gaps).toEqual([expect.objectContaining({ kind: 'no_contribution' })]);
  });

  it('treats a REASONED waiver as advisory and an unreasoned one as blocking', () => {
    const reasoned = computeAccountabilityGaps([slot({ state: 'waived' })], [
      signoff({ verdict: 'waived', waiveReason: 'Covered by the platform audit' }),
    ]);
    expect(reasoned).toEqual([expect.objectContaining({
      kind: 'waived', severity: 'advisory', reason: 'Covered by the platform audit',
    })]);

    const unreasoned = computeAccountabilityGaps([slot({ state: 'waived' })], [
      signoff({ verdict: 'waived', waiveReason: null }),
    ]);
    expect(unreasoned).toEqual([expect.objectContaining({ kind: 'waived', severity: 'blocking' })]);
  });

  it('still reports a ledger gap when the slot it belonged to is gone', () => {
    const gaps = computeAccountabilityGaps([], [signoff({ laneKey: null })]);
    expect(gaps).toEqual([expect.objectContaining({
      kind: 'no_contribution', roleName: 'Architect', stageKey: null, responsibility: null, state: null,
    })]);
  });
});

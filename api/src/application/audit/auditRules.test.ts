import { describe, it, expect } from 'vitest';
import { computeCoverage, requirementUnmetReason, type AuditSignals, type RequirementInput } from './auditRules';

const emptySignals = (): AuditSignals => ({
  approvedRoles: new Set(),
  changesRequestedRoles: new Set(),
  ranDiagnostics: new Set(),
  failedDiagnostics: new Set(),
  performedRoles: new Set(),
});

const req = (over: Partial<RequirementInput> = {}): RequirementInput => ({
  laneKey: 'in_review', laneName: 'Review', kind: 'review', ref: 'architect', isRequired: true, ...over,
});

describe('requirementUnmetReason', () => {
  it('marks a reviewer requirement missing until an approving sign-off exists', () => {
    const s = emptySignals();
    expect(requirementUnmetReason(req(), s)).toBe('missing');
    s.approvedRoles.add('architect');
    expect(requirementUnmetReason(req(), s)).toBeNull();
  });

  it('surfaces changes_requested over a stale approval', () => {
    const s = emptySignals();
    s.changesRequestedRoles.add('architect');
    expect(requirementUnmetReason(req(), s)).toBe('changes_requested');
  });

  it('satisfies a role owner requirement when that role performed work', () => {
    const s = emptySignals();
    const owner = req({ kind: 'role', responsibility: 'owner', ref: 'developer' });
    expect(requirementUnmetReason(owner, s)).toBe('missing');
    s.performedRoles.add('developer');
    expect(requirementUnmetReason(owner, s)).toBeNull();
  });

  it('checks diagnostics against the ran-diagnostics set', () => {
    const s = emptySignals();
    const diag = req({ kind: 'diagnostic', ref: 'security-posture' });
    expect(requirementUnmetReason(diag, s)).toBe('missing');
    s.ranDiagnostics.add('security-posture');
    expect(requirementUnmetReason(diag, s)).toBeNull();
  });

  it('a diagnostic that RAN but scored below the pass threshold stays unmet', () => {
    const s = emptySignals();
    const diag = req({ kind: 'diagnostic', ref: 'security-posture' });
    s.ranDiagnostics.add('security-posture');   // it ran
    s.failedDiagnostics.add('security-posture'); // …but below threshold
    expect(requirementUnmetReason(diag, s)).toBe('missing');
    // A later passing run clears the fail signal → satisfied.
    s.failedDiagnostics.delete('security-posture');
    expect(requirementUnmetReason(diag, s)).toBeNull();
  });
});

describe('computeCoverage — reviewer quorum (AC-4)', () => {
  const rev = (ref: string, quorum?: number): RequirementInput => ({ laneKey: 'in_review', laneName: 'Review', kind: 'review', ref, isRequired: true, quorum });

  it('a 2-of-3 reviewer set advances on the 2nd approval, not the 1st', () => {
    const reqs = [rev('code-reviewer', 2), rev('architect', 2), rev('team-lead', 2)];
    const s = emptySignals();
    // 0 approvals → flagged, needs 2.
    let r = computeCoverage(reqs, s);
    expect(r.status).toBe('flagged');
    expect(r.requiredCount).toBe(2);       // quorum, not 3
    // 1 approval → still short.
    s.approvedRoles.add('code-reviewer');
    r = computeCoverage(reqs, s);
    expect(r.status).toBe('flagged');
    expect(r.satisfiedCount).toBe(1);
    // 2 approvals → quorum met, pass (the 3rd is not required).
    s.approvedRoles.add('architect');
    r = computeCoverage(reqs, s);
    expect(r.status).toBe('pass');
    expect(r.satisfiedCount).toBe(2);
  });

  it('no quorum set = all reviewers must approve (legacy behaviour)', () => {
    const reqs = [rev('code-reviewer'), rev('architect')];
    const s = emptySignals();
    s.approvedRoles.add('code-reviewer');
    const r = computeCoverage(reqs, s);
    expect(r.status).toBe('flagged');
    expect(r.requiredCount).toBe(2);
  });
});

describe('computeCoverage', () => {
  it('passes when there are no required checks (100% coverage)', () => {
    const r = computeCoverage([req({ isRequired: false })], emptySignals());
    expect(r.status).toBe('pass');
    expect(r.coverage).toBe(100);
    expect(r.requiredCount).toBe(0);
  });

  it('flags a ticket missing a required reviewer sign-off', () => {
    const r = computeCoverage([req()], emptySignals());
    expect(r.status).toBe('flagged');
    expect(r.missing).toHaveLength(1);
    expect(r.missing[0]?.reason).toBe('missing');
    expect(r.coverage).toBe(0);
  });

  it('scores partial coverage across multiple required checks', () => {
    const s = emptySignals();
    s.approvedRoles.add('architect');
    const r = computeCoverage(
      [req({ ref: 'architect' }), req({ ref: 'qa-tester' })],
      s,
    );
    expect(r.status).toBe('flagged');
    expect(r.requiredCount).toBe(2);
    expect(r.satisfiedCount).toBe(1);
    expect(r.coverage).toBe(50);
    expect(r.missing.map((m) => m.ref)).toEqual(['qa-tester']);
  });

  it('passes when every required check is satisfied', () => {
    const s = emptySignals();
    s.approvedRoles.add('architect');
    s.approvedRoles.add('code-reviewer');
    const r = computeCoverage(
      [req({ ref: 'architect' }), req({ ref: 'code-reviewer' })],
      s,
    );
    expect(r.status).toBe('pass');
    expect(r.coverage).toBe(100);
  });
});

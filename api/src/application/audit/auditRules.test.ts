import { describe, it, expect } from 'vitest';
import { computeCoverage, requirementUnmetReason, type AuditSignals, type RequirementInput } from './auditRules';

const emptySignals = (): AuditSignals => ({
  approvedRoles: new Set(),
  changesRequestedRoles: new Set(),
  ranDiagnostics: new Set(),
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

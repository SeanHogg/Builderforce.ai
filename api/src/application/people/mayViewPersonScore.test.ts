/**
 * mayViewPersonScore.test.ts — the D14.6 visibility policy (WS22). A manager cannot
 * see a non-report's score (an RBAC test), a person sees their own, a tenant admin sees
 * everyone in the tenant, and an anonymous caller sees nothing.
 */
import { describe, expect, it } from 'vitest';
import { mayViewPersonScore, type PersonScoreViewer } from './mayViewPersonScore';

const viewer = (over: Partial<PersonScoreViewer> = {}): PersonScoreViewer => ({
  contributorId: 7,
  role: 'member',
  teamId: 3,
  ...over,
});

const subject = (over: Partial<{ contributorId: number; team: { id: number; managerId: number | null } | null }> = {}) => ({
  contributorId: 42,
  team: { id: 3, managerId: 7 },
  ...over,
});

describe('mayViewPersonScore (D14.6)', () => {
  it('a person sees their own scores', () => {
    const decision = mayViewPersonScore(viewer({ contributorId: 42 }), subject());
    expect(decision).toEqual({ allowed: true, reason: 'self' });
  });

  it('a manager sees a contributor on a team they manage', () => {
    const decision = mayViewPersonScore(viewer(), subject());
    expect(decision).toEqual({ allowed: true, reason: 'team-manager' });
  });

  it('a manager cannot see a non-report (RBAC)', () => {
    // Subject belongs to a team managed by someone else.
    const decision = mayViewPersonScore(viewer(), subject({ team: { id: 9, managerId: 99 } }));
    expect(decision).toEqual({ allowed: false, reason: 'not-a-report' });
  });

  it('a manager with no managed team sees nothing', () => {
    const decision = mayViewPersonScore(viewer({ teamId: null }), subject({ team: null }));
    expect(decision.allowed).toBe(false);
  });

  it('never grants on the viewer team id alone — the subject team must name the viewer as manager', () => {
    // Viewer "manages" team 3, but the subject is on team 9 managed by another.
    const decision = mayViewPersonScore(viewer({ teamId: 3 }), subject({ team: { id: 9, managerId: 55 } }));
    expect(decision.allowed).toBe(false);
  });

  it('a tenant admin sees everyone in the tenant', () => {
    const decision = mayViewPersonScore(viewer({ role: 'admin' }), subject({ team: null }));
    expect(decision).toEqual({ allowed: true, reason: 'tenant-admin' });
  });

  it('an anonymous caller (no contributor) sees nothing', () => {
    const decision = mayViewPersonScore(viewer({ contributorId: null }), subject());
    expect(decision).toEqual({ allowed: false, reason: 'anon' });
  });

  it('a plain member who is not the subject and not a manager sees nothing', () => {
    const decision = mayViewPersonScore(viewer({ contributorId: 8 }), subject());
    expect(decision.allowed).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import {
  resolveTieredManagerPolicy,
  DEFAULT_MANAGER_POLICY,
  type ManagerPolicyOverride,
} from './managerPolicy';

/**
 * The CEREMONY AUTONOMY half of the three-tier fold (migration 0365).
 *
 * Kept beside the general fold tests rather than inside them because these four fields
 * introduce a precedence rule the others do not have: two of them are NUMBERS resolved
 * most-restrictive-wins, where "most restrictive" points in opposite directions (longest
 * wait, smallest cap). That rule is the whole reason a project cannot loosen a workspace
 * guardrail just by writing a friendlier number, so it is worth pinning explicitly.
 */

const tier = (o: ManagerPolicyOverride = {}): ManagerPolicyOverride => o;

describe('ceremony autonomy — the grants are ceilings', () => {
  it('withholds both grants when nobody has an opinion', () => {
    const p = resolveTieredManagerPolicy({});
    expect(p.allowUnattendedCeremonies).toBe(false);
    expect(p.allowAgentReassignment).toBe(false);
  });

  it('grants when the workspace grants and the project is silent', () => {
    const p = resolveTieredManagerPolicy({
      tenant: tier({ allowUnattendedCeremonies: true, allowAgentReassignment: true }),
    });
    expect(p.allowUnattendedCeremonies).toBe(true);
    expect(p.allowAgentReassignment).toBe(true);
  });

  it('lets a project REFUSE authority the workspace granted', () => {
    const p = resolveTieredManagerPolicy({
      tenant: tier({ allowUnattendedCeremonies: true, allowAgentReassignment: true }),
      project: tier({ allowUnattendedCeremonies: false, allowAgentReassignment: false }),
    });
    expect(p.allowUnattendedCeremonies).toBe(false);
    expect(p.allowAgentReassignment).toBe(false);
  });

  it('does NOT let a project grant itself authority the workspace withheld', () => {
    // The ceiling. Without it, a per-project row would defeat the workspace posture —
    // exactly the failure `enabled` was given this treatment for in 0363.
    const p = resolveTieredManagerPolicy({
      tenant: tier({ allowUnattendedCeremonies: false, allowAgentReassignment: false }),
      project: tier({ allowUnattendedCeremonies: true, allowAgentReassignment: true }),
    });
    expect(p.allowUnattendedCeremonies).toBe(false);
    expect(p.allowAgentReassignment).toBe(false);
  });

  it('treats an undefined field (a row read before the migration) as no opinion', () => {
    const p = resolveTieredManagerPolicy({ tenant: tier({}), project: tier({}) });
    expect(p.allowUnattendedCeremonies).toBe(false);
    expect(p.allowAgentReassignment).toBe(false);
  });
});

describe('ceremony autonomy — the guardrail numbers resolve to the SAFEST value', () => {
  it('falls back to the built-in guardrails when nobody has an opinion', () => {
    const p = resolveTieredManagerPolicy({});
    expect(p.agentReassignIdleHours).toBe(DEFAULT_MANAGER_POLICY.agentReassignIdleHours);
    expect(p.agentReassignMaxPerSession).toBe(DEFAULT_MANAGER_POLICY.agentReassignMaxPerSession);
  });

  it('takes the LONGEST idle threshold across the tiers, not the nearest', () => {
    const p = resolveTieredManagerPolicy({
      tenant: tier({ agentReassignIdleHours: 72 }),
      project: tier({ agentReassignIdleHours: 12 }),   // a project cannot be hastier
    });
    expect(p.agentReassignIdleHours).toBe(72);
  });

  it('lets a project demand MORE patience than the workspace', () => {
    const p = resolveTieredManagerPolicy({
      tenant: tier({ agentReassignIdleHours: 24 }),
      project: tier({ agentReassignIdleHours: 168 }),
    });
    expect(p.agentReassignIdleHours).toBe(168);
  });

  it('takes the SMALLEST per-session cap across the tiers', () => {
    const p = resolveTieredManagerPolicy({
      tenant: tier({ agentReassignMaxPerSession: 5 }),
      project: tier({ agentReassignMaxPerSession: 20 }),  // a project cannot be looser
    });
    expect(p.agentReassignMaxPerSession).toBe(5);
  });

  it('lets a project set a TIGHTER cap than the workspace', () => {
    const p = resolveTieredManagerPolicy({
      tenant: tier({ agentReassignMaxPerSession: 10 }),
      project: tier({ agentReassignMaxPerSession: 1 }),
    });
    expect(p.agentReassignMaxPerSession).toBe(1);
  });

  it('honours an explicit zero cap (0 is an opinion, not an absence of one)', () => {
    const p = resolveTieredManagerPolicy({ tenant: tier({ agentReassignMaxPerSession: 0 }) });
    expect(p.agentReassignMaxPerSession).toBe(0);
  });

  it('IGNORES an out-of-range or malformed stored value rather than widening a bound', () => {
    const p = resolveTieredManagerPolicy({
      tenant: tier({ agentReassignIdleHours: 0, agentReassignMaxPerSession: 9999 }),
    });
    expect(p.agentReassignIdleHours).toBe(DEFAULT_MANAGER_POLICY.agentReassignIdleHours);
    expect(p.agentReassignMaxPerSession).toBe(DEFAULT_MANAGER_POLICY.agentReassignMaxPerSession);
  });

  it('ignores a NaN without collapsing the whole fold', () => {
    const p = resolveTieredManagerPolicy({
      tenant: tier({ agentReassignIdleHours: Number.NaN }),
      project: tier({ agentReassignIdleHours: 96 }),
    });
    expect(p.agentReassignIdleHours).toBe(96);
  });

  it('leaves the pre-existing policy fields untouched', () => {
    // Guards the fold against the four new fields having disturbed the 0362/0363 answers.
    const p = resolveTieredManagerPolicy({
      tenant: tier({ allowUnattendedCeremonies: true, allowAgentReassignment: true }),
    });
    expect(p.allowAutoMerge).toBe(false);
    expect(p.requireSignoffToComplete).toBe(false);
    expect(p.enabled).toBe(true);
  });
});

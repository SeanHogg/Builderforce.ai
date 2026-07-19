import { describe, it, expect } from 'vitest';
import { groupByTenant } from './autonomousExecutionSweep';
import { buildUpgradeCopy, upgradeEmailDedupeKey } from './pendingAgentsUpgradeEmail';

describe('groupByTenant', () => {
  it('buckets candidates by tenant, preserving per-tenant order', () => {
    const grouped = groupByTenant([
      { taskId: 1, projectId: 10, tenantId: 100, status: 'todo' },
      { taskId: 2, projectId: 11, tenantId: 200, status: 'todo' },
      { taskId: 3, projectId: 10, tenantId: 100, status: 'in_progress' },
    ]);
    expect(grouped.get(100)?.map((c) => c.taskId)).toEqual([1, 3]);
    expect(grouped.get(200)?.map((c) => c.taskId)).toEqual([2]);
    expect(grouped.size).toBe(2);
  });

  it('returns an empty map for no candidates', () => {
    expect(groupByTenant([]).size).toBe(0);
  });
});

describe('upgradeEmailDedupeKey', () => {
  it('is stable within a UTC day and rolls over at midnight', () => {
    const morning = new Date('2026-07-01T06:00:00Z');
    const night = new Date('2026-07-01T23:59:00Z');
    const nextDay = new Date('2026-07-02T00:01:00Z');
    expect(upgradeEmailDedupeKey(42, morning)).toBe('auto-exec:upgrade-emailed:42:2026-07-01');
    expect(upgradeEmailDedupeKey(42, night)).toBe(upgradeEmailDedupeKey(42, morning));
    expect(upgradeEmailDedupeKey(42, nextDay)).toBe('auto-exec:upgrade-emailed:42:2026-07-02');
  });

  it('is tenant-scoped', () => {
    const now = new Date('2026-07-01T06:00:00Z');
    expect(upgradeEmailDedupeKey(1, now)).not.toBe(upgradeEmailDedupeKey(2, now));
  });
});

describe('buildUpgradeCopy', () => {
  it('pluralizes and names the exhausted window', () => {
    const one = buildUpgradeCopy({ pendingAgents: 1, reason: 'daily_exhausted', effectivePlan: 'free' });
    expect(one.subject).toContain('1 agent is');
    expect(one.subject).toContain('daily');
    expect(one.intro).toContain('1 agent is');

    const many = buildUpgradeCopy({ pendingAgents: 5, reason: 'monthly_exhausted', effectivePlan: 'pro' });
    expect(many.subject).toContain('5 agents are');
    expect(many.subject).toContain('monthly');
    expect(many.intro).toContain('5 agents are');
  });

  it('tailors the upgrade hint to the current plan', () => {
    expect(buildUpgradeCopy({ pendingAgents: 2, reason: 'daily_exhausted', effectivePlan: 'free' }).upgradeHint)
      .toContain('Pro');
    expect(buildUpgradeCopy({ pendingAgents: 2, reason: 'daily_exhausted', effectivePlan: 'pro' }).upgradeHint)
      .toContain('Teams');
    // Teams is already the top plan — no "upgrade to X" pitch.
    expect(buildUpgradeCopy({ pendingAgents: 2, reason: 'monthly_exhausted', effectivePlan: 'teams' }).upgradeHint)
      .not.toContain('Upgrade to');
  });
});

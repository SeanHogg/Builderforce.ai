import { describe, expect, it } from 'vitest';
import { dueTrialNotice, spawnTrialView } from './spawnTrial';
import { spawnReturnUrl } from './spawnReturn';
import { readSpawnParentToken, signSpawnParentToken } from './spawnParentLink';
import { SPAWN_TRIAL_DAYS, SPAWN_TRIAL_TOKENS } from './spawnCatalog';
import { PLAN_LIMITS } from '../../domain/tenant/PlanLimits';
import { TenantPlan } from '../../domain/shared/types';
import type { SpawnMembership, SpawnTrial } from './spawnMembership';

const DAY = 24 * 60 * 60 * 1000;
const START = new Date('2026-10-05T12:00:00Z');
const at = (days: number) => new Date(START.getTime() + days * DAY);

const trial = (sent: SpawnTrial['sent'] = ['start']): SpawnTrial => ({
  startedAt: START.toISOString(),
  endsAt: at(SPAWN_TRIAL_DAYS).toISOString(),
  userId: 'u1',
  parentEmail: 'parent@example.com',
  sent,
});

const membership = (patch: Partial<SpawnMembership>): SpawnMembership => ({
  status: 'none', externalSubscriptionId: null, trial: null, updatedAt: null, ...patch,
});

describe('the Spawn free trial', () => {
  it('is seven days of the free plan’s monthly tokens', () => {
    expect(SPAWN_TRIAL_DAYS).toBe(7);
    expect(SPAWN_TRIAL_TOKENS).toBe(PLAN_LIMITS[TenantPlan.FREE].tokenMonthlyLimit);
  });

  it('emails the grown-up halfway, on the last day and at the end — the latest due only, once each', () => {
    expect(dueTrialNotice(trial(), at(1))).toBeNull();
    expect(dueTrialNotice(trial(), at(3))).toBe('midway');
    expect(dueTrialNotice(trial(['start', 'midway']), at(4))).toBeNull();
    expect(dueTrialNotice(trial(['start', 'midway']), at(6.5))).toBe('lastDay');
    // A sweep that missed days sends the current notice, not a stale "halfway" too.
    expect(dueTrialNotice(trial(), at(6.5))).toBe('lastDay');
    expect(dueTrialNotice(trial(['start', 'midway', 'lastDay']), at(7))).toBe('ended');
    expect(dueTrialNotice(trial(['start', 'midway', 'lastDay', 'ended']), at(9))).toBeNull();
  });

  it('is offered once: not to a workspace that had one, nor to a person who had one elsewhere', () => {
    expect(spawnTrialView(membership({}), false, START).available).toBe(true);
    expect(spawnTrialView(membership({}), true, START).available).toBe(false);
    expect(spawnTrialView(membership({ status: 'trial_ended', trial: trial() }), false, START).available).toBe(false);
    expect(spawnTrialView(membership({ status: 'active', trial: trial() }), false, START).available).toBe(false);
  });

  it('counts the days left while it runs', () => {
    const view = spawnTrialView(membership({ status: 'trial', trial: trial() }), true, at(2.5));
    expect(view.live).toBe(true);
    expect(view.daysLeft).toBe(5);
  });
});

describe('the grown-up’s link', () => {
  it('round-trips the workspace and player, and refuses a tampered or foreign token', async () => {
    const token = await signSpawnParentToken('secret', { tenantId: 42, userId: 'u1' });
    await expect(readSpawnParentToken('secret', token)).resolves.toEqual({ tenantId: 42, userId: 'u1' });
    await expect(readSpawnParentToken('other-secret', token)).rejects.toMatchObject({ code: 'parent_link_invalid' });
    await expect(readSpawnParentToken('secret', 'not-a-token')).rejects.toMatchObject({ code: 'parent_link_invalid' });
  });

  it('brings a parent checkout back to the parent page with its token', () => {
    expect(spawnReturnUrl('https://b.ai')).toBe('https://b.ai/spawn/account?');
    expect(spawnReturnUrl('https://b.ai', { kind: 'parent', token: 'a+b' })).toBe('https://b.ai/spawn/parent?t=a%2Bb&');
  });
});

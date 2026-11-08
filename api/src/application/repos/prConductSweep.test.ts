import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { CRON_SWEEPS } from '../../cronSweeps';
import { isConductedBySweep } from '../manager/triageStage';

const source = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url).href), 'utf8');

describe('PR conduct is its own registry sweep', () => {
  it('registers pr-conduct as a frequent, dispatching sweep beside pr-merge', () => {
    const sweep = CRON_SWEEPS.find((s) => s.key === 'pr-conduct');
    expect(sweep?.cadence).toBe('frequent');
    expect(sweep?.dispatches).toBe(true);
  });

  it('the manager pass no longer conducts anything or hands triage an in-memory set', () => {
    const manager = source('../manager/ManagerService.ts');
    expect(manager).not.toMatch(/coordinatePullRequests/);
    expect(manager).not.toMatch(/conductedTaskIds/);
    expect(manager).not.toMatch(/closeTicketAutomatically\(/);
    expect(manager).not.toMatch(/dispatchTaskFinalize\(/);
    expect(manager).toMatch(/summary\.prsMerged = await countPrMergesSince\(/);
  });

  it('the sweep skips the queue policy, bounds itself per ticket, and sheds between tickets', () => {
    const sweep = source('./prConductSweep.ts');
    expect(sweep).toMatch(/policy\.prMergePolicy === 'queue'\) return result/);
    expect(sweep).toMatch(/budget\.over\(\)\) \{ budget\.shed\('pr_conduct'\)/);
  });
});

describe('isConductedBySweep — triage defers to conduct from durable state', () => {
  it('claims a review ticket with no live run unless the policy is queue', () => {
    expect(isConductedBySweep({ status: 'in_review' }, 'immediate', false)).toBe(true);
    expect(isConductedBySweep({ status: 'in_review' }, 'on_green', false)).toBe(true);
    expect(isConductedBySweep({ status: 'in_review' }, 'queue', false)).toBe(false);
  });

  it('leaves the wait_for_build case (on_green, build neither green nor red) to triage', () => {
    expect(isConductedBySweep({ status: 'in_review' }, 'on_green', false, { buildStatus: 'pending' })).toBe(false);
    expect(isConductedBySweep({ status: 'in_review' }, 'on_green', false, { buildStatus: null })).toBe(false);
    expect(isConductedBySweep({ status: 'in_review' }, 'on_green', false, { buildStatus: 'success' })).toBe(true);
    expect(isConductedBySweep({ status: 'in_review' }, 'on_green', false, { buildStatus: 'failure' })).toBe(true);
    expect(isConductedBySweep({ status: 'in_review' }, 'immediate', false, { buildStatus: 'pending' })).toBe(true);
  });

  it('never claims a ticket with a live run or outside review', () => {
    expect(isConductedBySweep({ status: 'in_review' }, 'immediate', true)).toBe(false);
    expect(isConductedBySweep({ status: 'in_progress' }, 'immediate', false)).toBe(false);
  });
});

/**
 * signalMergeQueueOnCiResult — a CI verdict arms the `pr-merge` tick only for a ticket's PR that is
 * actually waiting open in a queue; everything else stays silent so a busy repo's CI traffic cannot
 * hold the cron gate (and Neon) open.
 */
import { describe, expect, it } from 'vitest';
import { fakeCronKv } from '../runtime/__fixtures__/fakeCronKv';
import { projectManagerConfigs } from '../../infrastructure/database/schema';
import { signalMergeQueueOnCiResult } from './ciMergeQueueSignal';

/** The read joins the project's manager opt-in, so `openPrs` is the rows that survive that join. */
const dbWith = (openPrs: Array<{ id: number }>) => ({
  select: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: async () => openPrs }) }) }) }),
}) as never;

describe('signalMergeQueueOnCiResult', () => {
  it('signals for a verdict on a ticket whose PR is still open', async () => {
    const { env, signalled } = fakeCronKv();
    const out = await signalMergeQueueOnCiResult(env, dbWith([{ id: 1 }]), { taskId: 7, tenantId: 3, buildStatus: 'success' });
    expect(out).toBe(true);
    expect(signalled()).toBe(true);
  });

  it('signals for a red build too — the queue head must be handed back', async () => {
    const { env, signalled } = fakeCronKv();
    await signalMergeQueueOnCiResult(env, dbWith([{ id: 1 }]), { taskId: 7, tenantId: 3, buildStatus: 'failure' });
    expect(signalled()).toBe(true);
  });

  it('does NOT signal when the ticket has no open PR waiting', async () => {
    const { env, signalled } = fakeCronKv();
    expect(await signalMergeQueueOnCiResult(env, dbWith([]), { taskId: 7, tenantId: 3, buildStatus: 'success' })).toBe(false);
    expect(signalled()).toBe(false);
  });

  it('reads the open PR through the project\'s manager opt-in, the same join the sweep selects by', async () => {
    const { env } = fakeCronKv();
    const joined: unknown[] = [];
    const db = {
      select: () => ({ from: () => ({ innerJoin: (table: unknown) => { joined.push(table); return { where: () => ({ limit: async () => [{ id: 1 }] }) }; } }) }),
    } as never;
    await signalMergeQueueOnCiResult(env, db, { taskId: 7, tenantId: 3, buildStatus: 'success' });
    expect(joined).toEqual([projectManagerConfigs]);
  });

  it('does NOT signal for an event that does not correlate to a ticket branch', async () => {
    const { env, signalled } = fakeCronKv();
    await signalMergeQueueOnCiResult(env, dbWith([{ id: 1 }]), { buildStatus: 'success' });
    expect(signalled()).toBe(false);
  });

  it('does NOT signal for an in-progress ping or a build the ingest already merged', async () => {
    const { env, signalled } = fakeCronKv();
    await signalMergeQueueOnCiResult(env, dbWith([{ id: 1 }]), { taskId: 7, tenantId: 3, buildStatus: 'pending' });
    await signalMergeQueueOnCiResult(env, dbWith([{ id: 1 }]), { taskId: 7, tenantId: 3, buildStatus: 'success', merged: true });
    expect(signalled()).toBe(false);
  });

  it('does not touch the database when no cron gate is bound', async () => {
    const throwing = { select: () => { throw new Error('should not query'); } } as never;
    expect(await signalMergeQueueOnCiResult({} as never, throwing, { taskId: 7, tenantId: 3, buildStatus: 'success' })).toBe(false);
  });
});

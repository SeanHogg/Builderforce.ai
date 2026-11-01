/**
 * Writes that arm cloud-workflow work signal the KV-gated cron tick — otherwise the run, schedule or
 * poll waits for the 30-minute floor on an idle platform:
 *   • `persistCompiledRun` (reached by `instantiateWorkflowRun`: manual, webhook, event, inbound email),
 *   • `syncDefinitionTriggers` (an RSS trigger polls on the next tick; a schedule arms a time).
 */
import { describe, expect, it, vi } from 'vitest';
import { fakeCronKv } from '../runtime/__fixtures__/fakeCronKv';

vi.mock('./eventTriggerListeners', () => ({ bumpEventTriggerListeners: vi.fn(async () => undefined) }));

import { persistCompiledRun } from './instantiateRun';
import { syncDefinitionTriggers } from './triggerSync';

const insertDb = { insert: () => ({ values: async () => undefined }) } as never;

describe('persistCompiledRun — cron gate', () => {
  const base = { tenantId: 1, name: 'Run' };

  it('signals for a CLOUD run when the caller passes its env', async () => {
    const { env, signalled } = fakeCronKv();
    const res = await persistCompiledRun(insertDb, [], { ...base, target: { runtime: 'cloud' }, env });
    expect(res.ok).toBe(true);
    expect(signalled()).toBe(true);
  });

  it('does NOT signal for a host-targeted run (its agent host picks it up, not the cron)', async () => {
    const { env, signalled } = fakeCronKv();
    await persistCompiledRun(insertDb, [], { ...base, target: { runtime: 'host', agentHostId: 4 }, env });
    expect(signalled()).toBe(false);
  });

  it('does NOT signal when the caller is the cron itself and passes no env', async () => {
    const { signalled } = fakeCronKv();
    await persistCompiledRun(insertDb, [], { ...base, target: { runtime: 'cloud' } });
    expect(signalled()).toBe(false);
  });
});

describe('syncDefinitionTriggers — cron gate', () => {
  /** select() = existing rows, delete() = clear, insert() = the new rows. */
  const syncDb = {
    select: () => ({ from: () => ({ where: async () => [] }) }),
    delete: () => ({ where: async () => undefined }),
    insert: () => ({ values: async () => undefined }),
  } as never;
  const defWith = (config: Record<string, unknown>) => ({
    nodes: [{ id: 'n1', kind: 'trigger', config }], edges: [],
  }) as never;
  const params = (config: Record<string, unknown>, env: unknown) => ({
    definitionId: 'd1', tenantId: 1, definition: defWith(config), target: { runtime: 'cloud' as const }, env: env as never,
  });

  it('signals when it arms an RSS trigger (polls on the next tick)', async () => {
    const { env, signalled } = fakeCronKv();
    await syncDefinitionTriggers(syncDb, params({ triggerType: 'rss', feedUrl: 'https://x.test/feed' }, env));
    expect(signalled()).toBe(true);
  });

  it('signals when it arms a schedule trigger', async () => {
    const { env, signalled } = fakeCronKv();
    await syncDefinitionTriggers(syncDb, params({ triggerType: 'schedule', cron: '0 9 * * *' }, env));
    expect(signalled()).toBe(true);
  });

  it('does NOT signal for a trigger with nothing to arm (webhook)', async () => {
    const { env, signalled } = fakeCronKv();
    await syncDefinitionTriggers(syncDb, params({ triggerType: 'webhook' }, env));
    expect(signalled()).toBe(false);
  });

  it('does NOT signal for a schedule whose cron is invalid (it arms nothing)', async () => {
    const { env, signalled } = fakeCronKv();
    await syncDefinitionTriggers(syncDb, params({ triggerType: 'schedule', cron: 'not a cron' }, env));
    expect(signalled()).toBe(false);
  });
});

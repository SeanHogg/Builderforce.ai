/**
 * The operator's per-workspace Insights switches (PRD 33 D8, D9): the merge keeps
 * every unrelated `tenants.settings` key, the change is audited with before/after,
 * and the reads that enforce the switches are dropped from cache.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  writeAdminAudit: vi.fn(),
  invalidateCached: vi.fn(async () => undefined),
  invalidateConsumptionSnapshot: vi.fn(async () => undefined),
}));

vi.mock('../../infrastructure/audit/adminAudit', () => ({ writeAdminAudit: mocks.writeAdminAudit }));
vi.mock('../../infrastructure/cache/readThroughCache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../infrastructure/cache/readThroughCache')>()),
  invalidateCached: mocks.invalidateCached,
}));
vi.mock('../consumption/meters', () => ({ invalidateConsumptionSnapshot: mocks.invalidateConsumptionSnapshot }));

import { NotFoundError, ValidationError } from '../../domain/shared/errors';
import {
  getReplayTenantSettings,
  mergeReplayTenantSettings,
  readReplayTenantSettings,
  REPLAY_TENANT_SETTINGS_CHANGED_EVENT,
  updateReplayTenantSettings,
} from './replayTenantSettings';

/** A fake handle: one `select … limit` answer and a record of the `update … set`. */
function fakeDb(rows: Array<{ settings: string | null }>) {
  const writes: Array<Record<string, unknown>> = [];
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: async () => rows,
  };
  const db = {
    select: () => chain,
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => { mocks.order.push('update'); writes.push(values); },
      }),
    }),
  };
  return { db: db as never, writes };
}

const env = {} as never;

beforeEach(() => {
  mocks.order = [];
  mocks.writeAdminAudit.mockReset().mockImplementation(async () => { mocks.order.push('audit'); });
  mocks.invalidateCached.mockClear();
  mocks.invalidateConsumptionSnapshot.mockClear();
});

describe('readReplayTenantSettings', () => {
  it('reads the switches the enforcing readers read', () => {
    expect(readReplayTenantSettings(null)).toEqual({ replayExcluded: false, replayFreeAllowanceOverride: null });
    expect(readReplayTenantSettings('{"replayExcluded":true,"replayFreeAllowanceOverride":0}'))
      .toEqual({ replayExcluded: true, replayFreeAllowanceOverride: 0 });
    expect(readReplayTenantSettings('{"replayExcluded":"yes","replayFreeAllowanceOverride":-3}'))
      .toEqual({ replayExcluded: false, replayFreeAllowanceOverride: null });
    expect(readReplayTenantSettings('not json')).toEqual({ replayExcluded: false, replayFreeAllowanceOverride: null });
  });
});

describe('mergeReplayTenantSettings', () => {
  it('preserves every unrelated key', () => {
    const raw = '{"embed":{"enabled":true},"navigationFeatures":["projects"],"replayFreeAllowanceOverride":10}';
    const merged = JSON.parse(mergeReplayTenantSettings(raw, { replayExcluded: true, replayFreeAllowanceOverride: 0 }));
    expect(merged).toEqual({
      embed: { enabled: true },
      navigationFeatures: ['projects'],
      replayExcluded: true,
      replayFreeAllowanceOverride: 0,
    });
  });

  it('removes the override when cleared', () => {
    const merged = JSON.parse(mergeReplayTenantSettings('{"replayFreeAllowanceOverride":10,"x":1}', {
      replayExcluded: false, replayFreeAllowanceOverride: null,
    }));
    expect(merged).toEqual({ x: 1, replayExcluded: false });
  });
});

describe('getReplayTenantSettings', () => {
  it('404s an unknown workspace', async () => {
    const { db } = fakeDb([]);
    await expect(getReplayTenantSettings(db, 9)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('updateReplayTenantSettings', () => {
  it('audits before/after, merges without clobbering, and drops the dependent caches', async () => {
    const { db, writes } = fakeDb([{ settings: '{"embed":{"enabled":true},"replayFreeAllowanceOverride":10}' }]);
    const after = await updateReplayTenantSettings(db, env, {
      actorId: 'op-1', tenantId: 7, patch: { replayFreeAllowanceOverride: 0 }, ipAddress: '203.0.113.9',
    });

    expect(after).toEqual({ replayExcluded: false, replayFreeAllowanceOverride: 0 });
    expect(mocks.order).toEqual(['audit', 'update']);
    expect(mocks.writeAdminAudit).toHaveBeenCalledWith(db, REPLAY_TENANT_SETTINGS_CHANGED_EVENT, 'op-1', {
      tenantId: 7,
      metadata: {
        before: { replayExcluded: false, replayFreeAllowanceOverride: 10 },
        after: { replayExcluded: false, replayFreeAllowanceOverride: 0 },
      },
      ipAddress: '203.0.113.9',
    });
    expect(JSON.parse(writes[0]!.settings as string)).toEqual({
      embed: { enabled: true }, replayExcluded: false, replayFreeAllowanceOverride: 0,
    });
    expect(mocks.invalidateCached).toHaveBeenCalledWith(env, 'replay:allowance-override:t7');
    expect(mocks.invalidateConsumptionSnapshot).toHaveBeenCalledWith(env, 7);
  });

  it('keeps the field the patch leaves out', async () => {
    const { db } = fakeDb([{ settings: '{"replayFreeAllowanceOverride":25}' }]);
    const after = await updateReplayTenantSettings(db, env, { actorId: 'op-1', tenantId: 7, patch: { replayExcluded: true } });
    expect(after).toEqual({ replayExcluded: true, replayFreeAllowanceOverride: 25 });
  });

  it('refuses an invalid override or an empty patch, writing nothing', async () => {
    const { db, writes } = fakeDb([{ settings: null }]);
    await expect(updateReplayTenantSettings(db, env, { actorId: 'op-1', tenantId: 7, patch: { replayFreeAllowanceOverride: -1 } }))
      .rejects.toBeInstanceOf(ValidationError);
    await expect(updateReplayTenantSettings(db, env, { actorId: 'op-1', tenantId: 7, patch: { replayFreeAllowanceOverride: 1.5 } }))
      .rejects.toBeInstanceOf(ValidationError);
    await expect(updateReplayTenantSettings(db, env, { actorId: 'op-1', tenantId: 7, patch: {} }))
      .rejects.toBeInstanceOf(ValidationError);
    expect(mocks.writeAdminAudit).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it('does not write the settings when the audit write fails', async () => {
    mocks.writeAdminAudit.mockRejectedValue(new Error('audit down'));
    const { db, writes } = fakeDb([{ settings: null }]);
    await expect(updateReplayTenantSettings(db, env, { actorId: 'op-1', tenantId: 7, patch: { replayExcluded: true } }))
      .rejects.toThrow('audit down');
    expect(writes).toHaveLength(0);
  });
});

/**
 * `runBulkAction` — the ONE bulk pass (PRD 47 §8 api): unknown entity, unsupported
 * action, missing permission, BULK_MAX + 1 → 400, merge without targetId, dryRun
 * writes nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BULK_MAX } from '@builderforce/interaction-contract';
import { ForbiddenError, NotFoundError, ValidationError } from '../../domain/shared/errors';
import { PERMISSIONS } from '../../domain/permissions/permissionRegistry';
import {
  clearBulkEntityPorts,
  registerBulkEntityPort,
  type BulkEntityPort,
} from './bulkEntityPorts';
import {
  runBulkAction,
  setBulkPermissionCheck,
} from './runBulkAction';
import type { Context } from 'hono';
import type { HonoEnv } from '../../env';

vi.mock('../activity/activityLog', () => ({
  recordActivityBatch: vi.fn(async () => {}),
  resolveActorFromContext: vi.fn(async () => ({ type: 'human', ref: 'u-1', name: 'U', engagementId: null })),
}));
import { recordActivityBatch } from '../activity/activityLog';

const ctx = (overrides: Record<string, unknown> = {}) =>
  ({
    env: {},
    get: (k: string) =>
      ({ db: 'db', tenantId: 7, userId: 'u-1', role: 'manager', ...overrides })[k],
  }) as unknown as Context<HonoEnv>;

const makePort = (over: Partial<BulkEntityPort> = {}): BulkEntityPort => ({
  entity: 'task',
  capabilities: ['delete', 'archive', 'restore', 'merge'],
  permissions: {
    delete: PERMISSIONS.TASK_WRITE,
    archive: PERMISSIONS.TASK_WRITE,
    restore: PERMISSIONS.TASK_WRITE,
    merge: PERMISSIONS.TASK_WRITE,
  },
  delete: vi.fn(async (_c, ids) => ({ succeeded: ids, skipped: [] })),
  archive: vi.fn(async (_c, ids) => ({ succeeded: ids, skipped: [] })),
  merge: vi.fn(async (_c, _t, sourceIds) => ({ succeeded: sourceIds, skipped: [] })),
  invalidate: vi.fn(async () => {}),
  ...over,
});

let restorePerm: (() => void) | undefined;

beforeEach(() => {
  clearBulkEntityPorts();
  vi.clearAllMocks();
  restorePerm = setBulkPermissionCheck(async () => true);
  return () => restorePerm?.();
});

describe('runBulkAction', () => {
  it('404s an unknown entity', async () => {
    await expect(runBulkAction(ctx(), { entity: 'nope', action: 'delete', ids: ['a'] }))
      .rejects.toBeInstanceOf(NotFoundError);
  });

  it('400s an action the entity does not offer', async () => {
    registerBulkEntityPort(makePort({ capabilities: ['archive'], permissions: { archive: PERMISSIONS.TASK_WRITE } }));
    await expect(runBulkAction(ctx(), { entity: 'task', action: 'delete', ids: ['a'] }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('403s when the member lacks the capability permission', async () => {
    registerBulkEntityPort(makePort());
    restorePerm?.();
    restorePerm = setBulkPermissionCheck(async () => false);
    await expect(runBulkAction(ctx(), { entity: 'task', action: 'delete', ids: ['a'] }))
      .rejects.toBeInstanceOf(ForbiddenError);
  });

  it('400s BULK_MAX + 1 ids before any write', async () => {
    const port = makePort();
    registerBulkEntityPort(port);
    const ids = Array.from({ length: BULK_MAX + 1 }, (_, i) => `t${i}`);
    await expect(runBulkAction(ctx(), { entity: 'task', action: 'delete', ids }))
      .rejects.toBeInstanceOf(ValidationError);
    expect(port.delete).not.toHaveBeenCalled();
  });

  it("400s a merge without a targetId, and a targetId that isn't in ids", async () => {
    const port = makePort();
    registerBulkEntityPort(port);
    await expect(runBulkAction(ctx(), { entity: 'task', action: 'merge', ids: ['a', 'b'] }))
      .rejects.toBeInstanceOf(ValidationError);
    await expect(runBulkAction(ctx(), { entity: 'task', action: 'merge', ids: ['a', 'b'], targetId: 'z' }))
      .rejects.toBeInstanceOf(ValidationError);
    expect(port.merge).not.toHaveBeenCalled();
  });

  it('dryRun writes nothing: no activity, no invalidate', async () => {
    const port = makePort();
    registerBulkEntityPort(port);
    await runBulkAction(ctx(), { entity: 'task', action: 'delete', ids: ['a', 'b'], dryRun: true });
    expect(port.delete).toHaveBeenCalled();
    expect(recordActivityBatch).not.toHaveBeenCalled();
    expect(port.invalidate).not.toHaveBeenCalled();
  });

  it('records one activity per succeeded id and invalidates on a real run', async () => {
    const port = makePort();
    registerBulkEntityPort(port);
    const r = await runBulkAction(ctx(), { entity: 'task', action: 'delete', ids: ['a', 'b'] });
    expect(r.succeeded).toEqual(['a', 'b']);
    expect(recordActivityBatch).toHaveBeenCalledTimes(1);
    expect(port.invalidate).toHaveBeenCalledWith(expect.anything(), ['a', 'b']);
  });
});

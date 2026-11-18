/**
 * The bulk-entity registry — one port per entity, resolved by key (PRD 47 §3.3).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearBulkEntityPorts,
  getBulkEntityPort,
  registerBulkEntityPort,
  type BulkEntityPort,
} from './bulkEntityPorts';
import { PERMISSIONS } from '../../domain/permissions/permissionRegistry';

const port = (entity: BulkEntityPort['entity']): BulkEntityPort => ({
  entity,
  capabilities: ['archive'],
  permissions: { archive: PERMISSIONS.TASK_WRITE },
  archive: async (_c, ids) => ({ succeeded: ids, skipped: [] }),
  invalidate: async () => {},
});

beforeEach(() => clearBulkEntityPorts());

describe('bulk entity port registry', () => {
  it('returns undefined for an unregistered entity (the route answers 404)', () => {
    expect(getBulkEntityPort('task')).toBeUndefined();
  });

  it('registers and resolves a port by its entity key', () => {
    registerBulkEntityPort(port('task'));
    expect(getBulkEntityPort('task')?.entity).toBe('task');
  });

  it('re-registering replaces the previous port (idempotent for tests)', () => {
    registerBulkEntityPort(port('task'));
    const next = port('task');
    registerBulkEntityPort(next);
    expect(getBulkEntityPort('task')).toBe(next);
  });

  it('clear empties the registry', () => {
    registerBulkEntityPort(port('task'));
    clearBulkEntityPorts();
    expect(getBulkEntityPort('task')).toBeUndefined();
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import { fakeDb } from '../../../test/fakeDb';
import {
  deprovisionManagedAgentHost,
  deprovisionOccupyingManagedAgentHosts,
  provisionManagedAgentHost,
} from './managedAgentHostProvision';
import type { ManagedAgentHostRuntime } from './managedAgentHostRuntime';

function stubRuntime(over: Partial<ManagedAgentHostRuntime> = {}): ManagedAgentHostRuntime & {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
} {
  return {
    start: vi.fn(async () => ({ ok: true as const })),
    stop: vi.fn(async () => {}),
    ...over,
  };
}

const pendingRow = {
  id: 3,
  tenantId: 7,
  agentHostName: 'east-1',
  region: 'us-east',
  status: 'pending',
  agentHostId: null,
  provisionedAt: null,
};

describe('provisionManagedAgentHost', () => {
  it('moves pending → provisioning → active with a real agentHostId', async () => {
    const provisioning = { ...pendingRow, status: 'provisioning' };
    const active = {
      ...provisioning,
      status: 'active',
      agentHostId: 88,
      provisionedAt: new Date('2026-02-02T00:00:00.000Z'),
    };
    const db = fakeDb([
      [pendingRow],
      [provisioning],
      [{ id: 88, tenantId: 7 }],
      [],
      [provisioning],
      [{ id: 88, tenantId: 7 }],
      [active],
    ]);
    const runtime = stubRuntime();
    const result = await provisionManagedAgentHost(db as unknown as Db, { runtime }, {
      requestId: 3,
      registeredBy: 'user-abc',
    });
    expect(result).toMatchObject({ request: { status: 'active', agentHostId: 88 } });
    expect(runtime.start).toHaveBeenCalledWith({ requestId: 3, tenantId: 7, region: 'us-east' });
    expect(db.calls.some((call) => call.kind === 'insert')).toBe(true);
  });

  it('marks the request failed when the container does not start, without an agentHostId', async () => {
    const provisioning = { ...pendingRow, status: 'provisioning' };
    const failed = { ...provisioning, status: 'failed', agentHostId: null };
    const db = fakeDb([
      [pendingRow],
      [provisioning],
      [{ id: 88, tenantId: 7 }],
      [{ apiKeyHash: 'hash' }],
      [],
      [provisioning],
      [failed],
    ]);
    const runtime = stubRuntime({
      start: vi.fn(async () => ({ ok: false as const, reason: 'managed host container health check failed' })),
    });
    const result = await provisionManagedAgentHost(db as unknown as Db, { runtime }, {
      requestId: 3,
      registeredBy: 'user-abc',
    });
    expect(result).toMatchObject({ error: { status: 503 } });
    expect(db.calls.some((call) => call.kind === 'delete')).toBe(true);
    expect(db.calls.at(-1)?.kind).toBe('update');
  });
});

describe('deprovisionManagedAgentHost', () => {
  it('cancels a pending request without stopping a container', async () => {
    const db = fakeDb([
      [pendingRow],
      [{ ...pendingRow, status: 'cancelled' }],
    ]);
    const runtime = stubRuntime();
    const result = await deprovisionManagedAgentHost(db as unknown as Db, { runtime }, {
      requestId: 3,
      tenantId: 7,
    });
    expect(result).toMatchObject({ request: { status: 'cancelled' } });
    expect(runtime.stop).not.toHaveBeenCalled();
  });

  it('stops the container, retires the host, and cancels an active request', async () => {
    const active = {
      id: 9,
      tenantId: 7,
      status: 'active',
      agentHostId: 42,
      agentHostName: 'east-1',
      region: 'us-east',
    };
    const db = fakeDb([
      [active],
      [{ apiKeyHash: 'hash' }],
      [],
      [{ ...active, status: 'cancelled' }],
    ]);
    const runtime = stubRuntime();
    const result = await deprovisionManagedAgentHost(db as unknown as Db, { runtime }, {
      requestId: 9,
      tenantId: 7,
    });
    expect(result).toMatchObject({ request: { status: 'cancelled' } });
    expect(runtime.stop).toHaveBeenCalledWith({ requestId: 9 });
    expect(db.calls.some((call) => call.kind === 'delete')).toBe(true);
  });
});

describe('deprovisionOccupyingManagedAgentHosts', () => {
  it('deprovisions provisioning and active hosts on add-on cancel', async () => {
    const occupying = { id: 9, agentHostId: 42 };
    const db = fakeDb([
      [occupying],
      [{ apiKeyHash: 'hash' }],
      [],
      [],
    ]);
    const runtime = stubRuntime();
    await deprovisionOccupyingManagedAgentHosts(db as unknown as Db, 4, { runtime });
    expect(runtime.stop).toHaveBeenCalledWith({ requestId: 9 });
    expect(db.calls.some((call) => call.kind === 'delete')).toBe(true);
    expect(db.calls.at(-1)?.kind).toBe('update');
  });

  it('is a no-op when nothing is occupying', async () => {
    const db = fakeDb([[]]);
    const runtime = stubRuntime();
    await deprovisionOccupyingManagedAgentHosts(db as unknown as Db, 4, { runtime });
    expect(runtime.stop).not.toHaveBeenCalled();
    expect(db.calls).toHaveLength(1);
  });
});

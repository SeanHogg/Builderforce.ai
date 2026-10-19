import { describe, expect, it } from 'vitest';
import { createLocalWork } from './localWork.js';
import type { EntityDestination } from './records.js';
import { createMemoryLocalFirstStore } from './store.js';

const DEVICE = 'device-1';
const AT = '2026-10-19T00:00:00.000Z';

describe('local work', () => {
  it('creates a project record and a create journal event with no network', async () => {
    const store = createMemoryLocalFirstStore();
    const work = createLocalWork(store);
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = ((input: unknown) => {
      calls.push(String(input));
      throw new Error('network_denied');
    }) as typeof fetch;

    try {
      const saved = await work.createProject({
        id: 'project-1',
        name: 'Offline board',
        key: 'OFF',
        deviceId: DEVICE,
        occurredAt: AT,
      });
      expect(saved.entityType).toBe('project');
      expect(saved.id).toBe('project-1');
      expect(saved.payload).toEqual({ name: 'Offline board', key: 'OFF' });
      expect(saved.provenance?.deviceId).toBe(DEVICE);
      expect(saved.destination).toEqual({ kind: 'unbound' });
    } finally {
      globalThis.fetch = original;
    }

    expect(calls).toEqual([]);
    const snapshot = await store.export();
    expect(snapshot.records).toEqual([
      expect.objectContaining({
        id: 'project-1',
        entityType: 'project',
        payload: { name: 'Offline board', key: 'OFF' },
      }),
    ]);
    expect(snapshot.events).toEqual([
      expect.objectContaining({
        clientEntityId: 'project-1',
        entityType: 'project',
        operation: 'create',
        occurredAt: AT,
        dependsOn: [],
      }),
    ]);
  });

  it('creates a ticket only when its project is already in the store', async () => {
    const store = createMemoryLocalFirstStore();
    const work = createLocalWork(store);
    const destination: EntityDestination = {
      kind: 'bound',
      accountId: 'acct-1',
      tenantId: 'tenant-a',
      projectId: 'project-1',
    };
    await work.createProject({
      id: 'project-1',
      name: 'Offline board',
      deviceId: DEVICE,
      destination,
      occurredAt: AT,
    });

    const ticket = await work.createTicket({
      id: 'ticket-1',
      projectId: 'project-1',
      title: 'Ship local create',
      description: 'No platform call.',
      deviceId: DEVICE,
      occurredAt: '2026-10-19T00:01:00.000Z',
    });

    expect(ticket.entityType).toBe('ticket');
    expect(ticket.payload).toEqual({
      projectId: 'project-1',
      title: 'Ship local create',
      description: 'No platform call.',
      status: 'backlog',
    });
    expect(ticket.destination).toEqual(destination);

    const snapshot = await store.export();
    const ticketEvent = snapshot.events.find((event) => event.clientEntityId === 'ticket-1');
    expect(ticketEvent).toEqual(expect.objectContaining({
      entityType: 'ticket',
      operation: 'create',
      dependsOn: ['project:project-1:v1'],
    }));
    expect(snapshot.records.filter((record) => record.entityType === 'ticket')).toHaveLength(1);
  });

  it('throws project_not_found and writes nothing when the project is missing', async () => {
    const store = createMemoryLocalFirstStore();
    const work = createLocalWork(store);
    await work.createProject({
      id: 'other-project',
      name: 'Already here',
      deviceId: DEVICE,
      occurredAt: AT,
    });
    const before = await store.export();

    await expect(work.createTicket({
      id: 'ticket-missing',
      projectId: 'missing-project',
      title: 'Should not land',
      deviceId: DEVICE,
    })).rejects.toThrow('project_not_found');

    expect(await store.export()).toEqual(before);
    const after = await store.export();
    expect(after.records.some((record) => record.id === 'ticket-missing')).toBe(false);
    expect(after.events.some((event) => event.clientEntityId === 'ticket-missing')).toBe(false);
  });
});

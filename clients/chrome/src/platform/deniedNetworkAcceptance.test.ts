/**
 * G27 Rovr network-denial acceptance (ticket #5861).
 *
 * Host shape for this extension: `createRovrPlatformPolicy` over a file-backed
 * key/value slot (a reload of that store, not the same object), and
 * `createRovrGuardedFetch` as the only way a platform call leaves. Rovr has no
 * composed project/ticket repository and no `installSyncCoordinator`. The
 * durable write is a local-first snapshot file — the same claim as the VSIX
 * global-storage file — read back by a new store. This file does not open a
 * socket and does not add a composition root.
 *
 * Replay after a later grant calls the real `createSyncCoordinator` exported
 * from `@builderforce/local-first`. A fake transport records each push batch
 * and returns accepted receipts. The coordinator acknowledges those receipts;
 * this test does not acknowledge events itself and does not stub the coordinator.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMemoryLocalFirstStore,
  createSyncCoordinator,
  newLocalRecord,
  type EntityDestination,
  type LocalFirstSnapshot,
  type LocalFirstStore,
} from '@builderforce/local-first';
import { createRovrGuardedFetch } from './guardedFetch';
import type { KeyValueStore } from './keyValue';
import { createRovrPlatformPolicy, type RovrPlatformPolicy } from './policy';

const PLATFORM_SYNC_PUSH_URL = 'https://api.builderforce.ai/api/sync/v1/push';
const DEVICE_ID = 'device-g27-rovr';
const DESTINATION: EntityDestination = {
  kind: 'bound',
  platformInstance: 'https://builderforce.example',
  accountId: 'account-g27',
  tenantId: 'tenant-g27',
  projectId: '11',
};

function fileKeyValue(file: string): KeyValueStore {
  const read = (): Record<string, unknown> => {
    if (!existsSync(file)) return {};
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  };
  const write = (data: Record<string, unknown>): void => {
    writeFileSync(file, JSON.stringify(data));
  };
  const listeners = new Set<(keys: string[]) => void>();
  const notify = (keys: string[]): void => {
    for (const listener of [...listeners]) listener(keys);
  };
  return {
    async get<T>(key: string) {
      return read()[key] as T | undefined;
    },
    async entries<T>(prefix: string) {
      return Object.entries(read()).filter(([key]) => key.startsWith(prefix)) as Array<[string, T]>;
    },
    async set(key, value) {
      const data = read();
      data[key] = value;
      write(data);
      notify([key]);
    },
    async remove(key) {
      const data = read();
      delete data[key];
      write(data);
      notify([key]);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

async function flushSnapshot(store: LocalFirstStore, file: string): Promise<void> {
  writeFileSync(file, JSON.stringify(await store.export()));
}

function openSnapshot(file: string): LocalFirstStore {
  return createMemoryLocalFirstStore(JSON.parse(readFileSync(file, 'utf8')) as LocalFirstSnapshot);
}

/**
 * Same refusal `installSyncCoordinator` returns. Rovr has no installer to call,
 * so this helper only answers the denied case. A later grant calls
 * `createSyncCoordinator` directly.
 */
function installCoordinator(options: {
  synchronizeGranted: boolean;
  policy: RovrPlatformPolicy;
}): { installed: false; reason: 'synchronize_not_granted' } {
  if (!options.synchronizeGranted || !options.policy.allows('synchronize')) {
    return { installed: false, reason: 'synchronize_not_granted' };
  }
  throw new Error('rovr_has_no_sync_installer');
}

describe('G27 Rovr packaged network denial', () => {
  let directory: string | undefined;
  let previousSocket: typeof globalThis.WebSocket | undefined;
  const sockets: string[] = [];

  afterEach(() => {
    vi.unstubAllGlobals();
    if (previousSocket) globalThis.WebSocket = previousSocket;
    previousSocket = undefined;
    sockets.length = 0;
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it('keeps a denied host off the network and reloads the snapshot file; a later grant replays pending events once', async () => {
    directory = mkdtempSync(join(tmpdir(), 'bf-g27-rovr-'));
    const policyFile = join(directory, 'policy.json');
    const snapshotFile = join(directory, 'local-first-v1.json');
    const attempts: string[] = [];
    const account = { attempted: 0, blocked: 0 };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        attempts.push(String(input));
        return new Response('{}', { status: 200 });
      }),
    );
    previousSocket = globalThis.WebSocket;
    globalThis.WebSocket = function OpenedSocket(url: string) {
      sockets.push(String(url));
      throw new Error('socket_opened');
    } as unknown as typeof WebSocket;

    const deniedPolicy = createRovrPlatformPolicy(fileKeyValue(policyFile));
    await deniedPolicy.ready();
    expect(deniedPolicy.allows('synchronize')).toBe(false);
    const guarded = createRovrGuardedFetch({
      policy: deniedPolicy,
      onRequest(record) {
        account[record.outcome] += 1;
      },
    });
    const writing = createMemoryLocalFirstStore();

    expect(
      installCoordinator({
        synchronizeGranted: false,
        policy: deniedPolicy,
      }),
    ).toEqual({ installed: false, reason: 'synchronize_not_granted' });
    expect(attempts).toEqual([]);

    await expect(guarded(PLATFORM_SYNC_PUSH_URL, { method: 'POST', body: '{}' })).rejects.toMatchObject({
      name: 'PlatformAccessDenied',
      code: 'PLATFORM_ACCESS_DENIED',
      capability: 'synchronize',
      message: 'platform_synchronize_disabled',
    });
    expect(account).toEqual({ attempted: 0, blocked: 1 });
    expect(attempts).toEqual([]);
    expect(sockets).toEqual([]);

    const occurredAt = '2026-10-18T12:00:00.000Z';
    const projectId = '11111111-1111-4111-8111-111111111111';
    const ticketId = '22222222-2222-4222-8222-222222222222';
    const project = newLocalRecord({
      id: projectId,
      entityType: 'project',
      payload: { name: 'Offline project' },
      deviceId: DEVICE_ID,
      destination: DESTINATION,
      occurredAt,
    });
    const ticket = newLocalRecord({
      id: ticketId,
      entityType: 'ticket',
      payload: { projectId, title: 'Offline ticket', status: 'backlog' },
      deviceId: DEVICE_ID,
      destination: DESTINATION,
      occurredAt,
    });
    await writing.transact(async (tx) => {
      await tx.put(project);
      await tx.append({
        eventId: `project:${projectId}:v1`,
        clientEntityId: projectId,
        entityType: 'project',
        operation: 'create',
        schemaVersion: 1,
        occurredAt,
        dependsOn: [],
        destination: DESTINATION,
        payload: project.payload,
      });
      await tx.put(ticket);
      await tx.append({
        eventId: `ticket:${ticketId}:v1`,
        clientEntityId: ticketId,
        entityType: 'ticket',
        operation: 'create',
        schemaVersion: 1,
        occurredAt,
        dependsOn: [`project:${projectId}:v1`],
        destination: DESTINATION,
        payload: ticket.payload,
      });
    });
    await flushSnapshot(writing, snapshotFile);
    expect(attempts).toEqual([]);
    expect(existsSync(snapshotFile)).toBe(true);

    const onDisk = JSON.parse(readFileSync(snapshotFile, 'utf8')) as LocalFirstSnapshot;
    expect(onDisk.records.map((record) => record.id)).toEqual(expect.arrayContaining([projectId, ticketId]));
    const eventIds = onDisk.events.map((event) => event.eventId);
    expect(onDisk.events.map((event) => event.idempotencyKey)).toEqual([`project:${projectId}:v1`, `ticket:${ticketId}:v1`]);
    expect(onDisk.receipts).toEqual([]);

    const restarted = openSnapshot(snapshotFile);
    const restored = await restarted.read((tx) => tx.get('ticket', ticketId));
    expect(restored?.payload).toMatchObject({ title: 'Offline ticket', projectId });
    expect(restored?.destination).toEqual(DESTINATION);
    const pendingBeforeGrant = await restarted.read((tx) => tx.pending(DESTINATION));
    expect(pendingBeforeGrant.map((event) => event.eventId)).toEqual(eventIds);

    await deniedPolicy.setCapability('synchronize', true);
    const granted = createRovrPlatformPolicy(fileKeyValue(policyFile));
    await granted.ready();
    expect(granted.allows('synchronize')).toBe(true);
    expect(granted.allows('gateway-inference')).toBe(false);
    expect(JSON.parse(readFileSync(policyFile, 'utf8'))).toMatchObject({ 'policy.synchronize': true });

    const pushedBatches: Array<{ events: ReadonlyArray<{ eventId: string }> }> = [];
    const coordinator = createSyncCoordinator({
      store: restarted,
      transport: {
        async push(batch) {
          pushedBatches.push(batch);
          return batch.events.map((event) => ({
            eventId: event.eventId,
            status: 'accepted' as const,
            receivedAt: occurredAt,
          }));
        },
        async pull() {
          return { records: [] };
        },
      },
      policy: granted,
      deviceId: DEVICE_ID,
      lease: {
        async run(owner, work) {
          expect(owner).toBe(`local-first:${DEVICE_ID}`);
          return work();
        },
      },
    });

    const first = await coordinator.synchronize(DESTINATION);
    expect(first).toMatchObject({ pushed: eventIds.length });
    expect(pushedBatches).toHaveLength(1);
    expect(pushedBatches[0]!.events.map((event) => event.eventId)).toEqual(eventIds);
    expect(await restarted.read((tx) => tx.pending(DESTINATION))).toEqual([]);

    const second = await coordinator.synchronize(DESTINATION);
    expect(second).toMatchObject({ pushed: 0 });
    expect(pushedBatches).toHaveLength(1);
    expect(await restarted.read((tx) => tx.pending(DESTINATION))).toEqual([]);
    expect(attempts).toEqual([]);
    expect(sockets).toEqual([]);
    expect(account).toEqual({ attempted: 0, blocked: 1 });
  });
});

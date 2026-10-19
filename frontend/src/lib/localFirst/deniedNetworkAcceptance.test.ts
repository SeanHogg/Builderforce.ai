// @vitest-environment jsdom
/**
 * G27 web network-denial acceptance (ticket #5861).
 *
 * Drives the existing page gate (`bootWebPlatformPolicy`, `webPlatformFetch`,
 * `webPlatformPolicy`). The durable write is `bootLocalWorkManagement` over
 * IndexedDB: close it, open the same database again, and read the ticket from
 * a different store object. A later grant replays that pending batch through
 * `createSyncCoordinator` and the same policy object.
 *
 * The recording transport does not call fetch. This file does not open a
 * socket, does not install a second policy, and does not load a packaged
 * VSIX, so a passing run does not close the packaged three-host gate.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexedDB } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSyncCoordinator,
  type EntityDestination,
  type SyncTransport,
} from '@builderforce/local-first';
import { API_ORIGIN } from '../apiOrigin';
import { bootLocalWorkManagement, type LocalWorkManagementBoot } from './workManagementBoot';
import {
  bootWebPlatformPolicy,
  connectAccountSync,
  resetWebPlatformPolicyForTests,
  webPlatformFetch,
  webPlatformPolicy,
  webPlatformRequestAccount,
} from './platformPolicy';

const here = dirname(fileURLToPath(import.meta.url));
const scenarioPath = fileURLToPath(import.meta.url);
const layoutPath = resolve(here, '../../app/layout.tsx');
const bootComponentPath = resolve(here, '../../components/PlatformPolicyBoot.tsx');
const policyPath = resolve(here, 'platformPolicy.ts');

const DEVICE_ID = 'device-g27-web';
const OCCURRED_AT = '2026-10-18T12:00:00.000Z';
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const TICKET_ID = '22222222-2222-4222-8222-222222222222';
const DESTINATION: EntityDestination = {
  kind: 'bound',
  platformInstance: 'https://builderforce.example',
  accountId: 'account-g27',
  tenantId: 'tenant-g27',
  projectId: '11',
};
const PLATFORM_SYNC_PUSH_URL = `${API_ORIGIN}/api/sync/v1/push`;
const PROJECT_EVENT = `project:${PROJECT_ID}:v1`;
const TICKET_EVENT = `ticket:${TICKET_ID}:v1`;

function executable(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function recordingTransport(pushed: string[]): SyncTransport {
  return {
    async push(batch) {
      pushed.push(...batch.events.map((event) => event.eventId));
      return batch.events.map((event) => ({
        eventId: event.eventId,
        status: 'accepted' as const,
        receivedAt: OCCURRED_AT,
      }));
    },
    async pull() {
      return { records: [] };
    },
  };
}

function closedTransport(): SyncTransport {
  return {
    async push() {
      throw new Error('network_opened');
    },
    async pull() {
      throw new Error('network_opened');
    },
  };
}

describe('G27 web network denial', () => {
  const open: LocalWorkManagementBoot[] = [];
  let previousSocket: typeof globalThis.WebSocket | undefined;

  afterEach(() => {
    for (const booted of open) booted.close();
    open.length = 0;
    resetWebPlatformPolicyForTests();
    window.localStorage.clear();
    vi.unstubAllGlobals();
    if (previousSocket) globalThis.WebSocket = previousSocket;
    previousSocket = undefined;
  });

  it('keeps a denied web host off the network, restarts the IndexedDB write, and replays the batch later without opening the network', async () => {
    const scenario = executable(readFileSync(scenarioPath, 'utf8'));
    const imports = scenario.slice(0, scenario.indexOf('function executable'));
    expect(scenario).toContain('webPlatformFetch(');
    expect(scenario).toContain('bootWebPlatformPolicy()');
    expect(scenario).toContain('bootLocalWorkManagement(');
    expect(imports).not.toContain('networkDenialScenario');
    expect(imports).not.toContain("from './policy'");
    expect(imports).not.toContain('clients/chrome');
    expect(imports).not.toContain('clients/vscode');
    expect(readFileSync(layoutPath, 'utf8')).toContain('<PlatformPolicyBoot />');
    expect(executable(readFileSync(bootComponentPath, 'utf8'))).toContain('bootWebPlatformPolicy()');
    const policySource = executable(readFileSync(policyPath, 'utf8'));
    expect(policySource).toContain('export function webPlatformFetch(');
    expect(policySource).not.toContain('WEB_CONNECTED_GRANTS');

    const attempts: string[] = [];
    const sockets: string[] = [];
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

    window.localStorage.clear();
    resetWebPlatformPolicyForTests();
    bootWebPlatformPolicy();
    expect(webPlatformPolicy().allows('synchronize')).toBe(false);
    expect(webPlatformPolicy().allows('gateway-inference')).toBe(false);
    expect(webPlatformRequestAccount()).toMatchObject({ attempted: 0, blocked: 0 });

    await expect(
      webPlatformFetch(PLATFORM_SYNC_PUSH_URL, { method: 'POST', body: '{}' }, 'synchronize'),
    ).rejects.toMatchObject({
      name: 'PlatformAccessDenied',
      code: 'PLATFORM_ACCESS_DENIED',
      capability: 'synchronize',
      message: 'platform_synchronize_disabled',
    });
    expect(webPlatformRequestAccount()).toMatchObject({ attempted: 0, blocked: 1 });
    expect(attempts).toEqual([]);
    expect(sockets).toEqual([]);

    const deniedPushes: string[] = [];
    const deniedStore = await bootLocalWorkManagement({
      indexedDB,
      dbName: `g27-web-denied-${crypto.randomUUID()}`,
      deviceId: DEVICE_ID,
      destination: DESTINATION,
    });
    open.push(deniedStore);
    const denied = createSyncCoordinator({
      store: deniedStore.store!,
      transport: closedTransport(),
      policy: webPlatformPolicy(),
      deviceId: DEVICE_ID,
      lease: {
        async run(_owner, work) {
          deniedPushes.push('lease');
          return work();
        },
      },
    });
    await expect(denied.synchronize(DESTINATION)).rejects.toMatchObject({
      name: 'PlatformAccessDenied',
      capability: 'synchronize',
    });
    expect(deniedPushes).toEqual([]);
    expect(attempts).toEqual([]);

    const dbName = `g27-web-${crypto.randomUUID()}`;
    const ids = [PROJECT_ID, TICKET_ID];
    let nextId = 0;
    const writing = await bootLocalWorkManagement({
      indexedDB,
      dbName,
      deviceId: DEVICE_ID,
      destination: DESTINATION,
      newId: () => ids[nextId++] ?? crypto.randomUUID(),
    });
    open.push(writing);
    expect(writing.storage).toBe('durable');
    expect(writing.store).toBeDefined();
    expect(writing.work).toBeDefined();
    const project = await writing.work!.createProject({ name: 'Offline project' });
    const ticket = await writing.work!.createTicket({ projectId: project.id, title: 'Offline ticket' });
    expect(project.id).toBe(PROJECT_ID);
    expect(ticket.id).toBe(TICKET_ID);
    expect(ticket.payload).toMatchObject({ title: 'Offline ticket', projectId: PROJECT_ID, status: 'backlog' });
    expect(ticket.destination).toEqual(DESTINATION);
    const writtenPending = await writing.store!.read((tx) => tx.pending(DESTINATION));
    expect(writtenPending.map((event) => event.eventId)).toEqual([PROJECT_EVENT, TICKET_EVENT]);
    expect(attempts).toEqual([]);
    writing.close();

    const restarted = await bootLocalWorkManagement({
      indexedDB,
      dbName,
      deviceId: DEVICE_ID,
      destination: DESTINATION,
    });
    open.push(restarted);
    expect(restarted.store).toBeDefined();
    expect(restarted.store).not.toBe(writing.store);
    const restored = await restarted.work!.listTickets({ projectId: PROJECT_ID });
    expect(restored.map((row) => row.id)).toEqual([TICKET_ID]);
    expect(restored[0]?.payload).toMatchObject({ title: 'Offline ticket', projectId: PROJECT_ID });
    expect(restored[0]?.destination).toEqual(DESTINATION);
    const pendingBeforeGrant = await restarted.store!.read((tx) => tx.pending(DESTINATION));
    expect(pendingBeforeGrant.map((event) => event.eventId)).toEqual([PROJECT_EVENT, TICKET_EVENT]);
    expect(attempts).toEqual([]);
    expect(sockets).toEqual([]);

    connectAccountSync();
    expect(webPlatformPolicy().allows('synchronize')).toBe(true);
    expect(webPlatformPolicy().allows('gateway-inference')).toBe(false);

    const replayed: string[] = [];
    const coordinator = createSyncCoordinator({
      store: restarted.store!,
      transport: recordingTransport(replayed),
      policy: webPlatformPolicy(),
      deviceId: DEVICE_ID,
      lease: {
        async run(owner, work) {
          expect(owner).toBe(`local-first:${DEVICE_ID}`);
          return work();
        },
      },
    });
    const first = await coordinator.synchronize(DESTINATION);
    expect(first).toMatchObject({ pushed: 2 });
    expect(replayed).toEqual([PROJECT_EVENT, TICKET_EVENT]);
    expect(await restarted.store!.read((tx) => tx.pending(DESTINATION))).toEqual([]);

    const second = await coordinator.synchronize(DESTINATION);
    expect(second).toMatchObject({ pushed: 0 });
    expect(replayed).toEqual([PROJECT_EVENT, TICKET_EVENT]);
    expect(attempts).toEqual([]);
    expect(sockets).toEqual([]);
    expect(webPlatformRequestAccount()).toMatchObject({ attempted: 0, blocked: 1 });

    restarted.close();
    const reread = await bootLocalWorkManagement({
      indexedDB,
      dbName,
      deviceId: DEVICE_ID,
      destination: DESTINATION,
    });
    open.push(reread);
    expect(reread.store).not.toBe(restarted.store);
    expect(await reread.store!.read((tx) => tx.pending(DESTINATION))).toEqual([]);
    const receipts = await reread.store!.export();
    expect(receipts.receipts.map((receipt) => receipt.eventId).sort()).toEqual([PROJECT_EVENT, TICKET_EVENT].sort());
    expect(receipts.receipts.every((receipt) => receipt.status === 'accepted')).toBe(true);
    const stillThere = await reread.work!.listTickets({ projectId: PROJECT_ID });
    expect(stillThere[0]?.payload).toMatchObject({ title: 'Offline ticket', projectId: PROJECT_ID });
    expect(attempts).toEqual([]);
    expect(sockets).toEqual([]);
  });
});

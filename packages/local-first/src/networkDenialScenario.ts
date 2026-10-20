/**
 * G27 network-denial scenario (in-process stand-in).
 *
 * One function drives the same steps for web, Rovr, and VSIX. With the
 * network denied it rejects a platform call without performing it, records a
 * durable local write, reopens that write in a second store, and replays the
 * queued batch later.
 *
 * This is an in-process stand-in.
 * it does not drive a packaged extension or a real browser, so it does not by itself close G27.
 */

import { recordIfDenied, type DeniedCallRecord } from './deniedCallRecord.js';
import { gate } from './platformGate.js';
import { platformConnectivity } from './platformDeniedDefault.js';
import { LOCAL_FIRST_POLICY } from './policy.js';
import { type EntityDestination } from './records.js';
import {
  createMemoryLocalFirstStore,
  newLocalRecord,
  type LocalFirstSnapshot,
  type LocalFirstStore,
} from './store.js';
import { SYNC_PROTOCOL_VERSION, type SyncPushBatch } from './sync.js';

export const NETWORK_DENIAL_HOSTS = ['web', 'rovr', 'vsix'] as const;

export type NetworkDenialHost = (typeof NETWORK_DENIAL_HOSTS)[number];

export interface NetworkDenialWrite {
  readonly id: string;
  readonly eventId: string;
  readonly entityType: 'ticket';
  readonly title: string;
  readonly host: NetworkDenialHost;
}

export interface NetworkDenialBatchReplay {
  readonly later: true;
  readonly replayedAfterRestart: true;
  readonly batchId: string;
  readonly protocolVersion: number;
  readonly eventIds: readonly string[];
  readonly platformCallPerformed: false;
}

export interface NetworkDenialScenarioResult {
  readonly host: NetworkDenialHost;
  readonly networkDenied: true;
  readonly platformCallRejected: true;
  readonly platformCallPerformed: false;
  readonly platformCallCount: 0;
  readonly deniedCall: DeniedCallRecord & { readonly recorded: true };
  readonly write: NetworkDenialWrite;
  readonly restarted: true;
  readonly secondStoreRead: true;
  readonly readAfterRestart: NetworkDenialWrite;
  readonly batchReplayed: NetworkDenialBatchReplay;
  /** A passing run of this function is not the packaged three-host gate. */
  readonly closesG27: false;
}

const OCCURRED_AT = '2026-10-18T12:00:00.000Z';
const REPLAYED_AT = '2026-10-18T12:05:00.000Z';

export function isNetworkDenialHost(host: string): host is NetworkDenialHost {
  return (NETWORK_DENIAL_HOSTS as readonly string[]).includes(host);
}

function destinationFor(host: NetworkDenialHost): EntityDestination {
  return {
    kind: 'bound',
    platformInstance: 'local',
    accountId: `account-${host}`,
    tenantId: 'tenant-local',
    projectId: '11',
  };
}

/**
 * Reject the platform call. The performer is the only place a call would
 * leave the process, and it is not invoked while the network is denied.
 */
function rejectPlatformCall(host: NetworkDenialHost): {
  readonly rejected: true;
  readonly performed: false;
  readonly count: 0;
  readonly deniedCall: DeniedCallRecord & { readonly recorded: true };
} {
  const connectivity = platformConnectivity({
    apiDenied: true,
    savedGatewayKey: true,
    localModelsEnabled: true,
    gatewayFallback: true,
  });
  if (
    connectivity.platform !== 'denied'
    || connectivity.inference !== 'local-only'
    || connectivity.sync !== 'local'
  ) {
    throw new Error('network_not_denied');
  }

  const calls: string[] = [];
  const perform = (url: string): void => {
    calls.push(`${host}:${url}`);
  };
  const decision = gate({ action: 'denied' });
  if (decision.proceed) {
    perform('platform://sync/v1/push');
    throw new Error('platform_call_performed');
  }
  if (decision.reason !== 'denied') throw new Error('platform_call_not_denied');

  const sink: DeniedCallRecord[] = [];
  const recorded = recordIfDenied(LOCAL_FIRST_POLICY, 'synchronize', sink);
  const deniedCall = sink[0];
  if (recorded.recorded !== true || deniedCall?.replayable !== true || calls.length !== 0) {
    throw new Error('denied_call_not_recorded');
  }
  return {
    rejected: true,
    performed: false,
    count: 0,
    deniedCall: { capability: deniedCall.capability, replayable: true, recorded: true },
  };
}

async function writeAndRestart(host: NetworkDenialHost): Promise<{
  readonly write: NetworkDenialWrite;
  readonly store: LocalFirstStore;
  readonly destination: EntityDestination;
  readonly deviceId: string;
}> {
  const destination = destinationFor(host);
  const deviceId = `device-${host}`;
  const write: NetworkDenialWrite = {
    id: `ticket-${host}`,
    eventId: `event-${host}`,
    entityType: 'ticket',
    title: `offline-${host}`,
    host,
  };
  const ticket = newLocalRecord({
    id: write.id,
    entityType: write.entityType,
    payload: { title: write.title, host, status: 'open' },
    deviceId,
    destination,
    occurredAt: OCCURRED_AT,
  });
  const first = createMemoryLocalFirstStore();
  await first.transact(async (tx) => {
    await tx.put(ticket);
    await tx.append({
      eventId: write.eventId,
      clientEntityId: ticket.id,
      entityType: ticket.entityType,
      operation: 'create',
      schemaVersion: ticket.schemaVersion,
      occurredAt: ticket.occurredAt,
      dependsOn: [],
      destination: ticket.destination,
      payload: ticket.payload,
    });
  });

  const exported = await first.export();
  const snapshot = JSON.parse(JSON.stringify(exported)) as LocalFirstSnapshot;
  const second = createMemoryLocalFirstStore(snapshot);
  const restored = await second.read((tx) => tx.get<{ title: string; host: NetworkDenialHost }>('ticket', write.id));
  const pending = await second.read((tx) => tx.pending(destination));
  if (
    restored?.id !== write.id
    || restored.payload.title !== write.title
    || restored.payload.host !== host
    || !pending.some((event) => event.eventId === write.eventId)
  ) {
    throw new Error('write_lost_on_restart');
  }
  return { write, store: second, destination, deviceId };
}

async function replayBatchLater(
  store: LocalFirstStore,
  destination: EntityDestination,
  deviceId: string,
  host: NetworkDenialHost,
  platformCallCount: number,
): Promise<NetworkDenialBatchReplay> {
  if (platformCallCount !== 0) throw new Error('platform_call_performed');
  const pending = await store.read((tx) => tx.pending(destination));
  if (pending.length === 0) throw new Error('batch_empty');
  const batch: SyncPushBatch = {
    batchId: `later-replay-${host}`,
    protocolVersion: SYNC_PROTOCOL_VERSION,
    deviceId,
    destination,
    events: pending,
  };
  await store.transact(async (tx) => {
    for (const event of batch.events) {
      await tx.putReceipt({
        eventId: event.eventId,
        status: 'accepted',
        receivedAt: REPLAYED_AT,
        detail: 'in_process_replay',
      });
    }
  });
  const receipts = (await store.export()).receipts;
  const eventIds = batch.events.map((event) => event.eventId);
  for (const eventId of eventIds) {
    const receipt = receipts.find((row) => row.eventId === eventId);
    if (receipt?.status !== 'accepted' || receipt.detail !== 'in_process_replay') {
      throw new Error('batch_not_replayed');
    }
  }
  return {
    later: true,
    replayedAfterRestart: true,
    batchId: batch.batchId,
    protocolVersion: batch.protocolVersion,
    eventIds,
    platformCallPerformed: false,
  };
}

/**
 * Run the denied-network scenario for one host.
 * `web`, `rovr`, and `vsix` share this function. Any other name is refused.
 */
export async function runNetworkDenialScenario(
  host: NetworkDenialHost,
): Promise<NetworkDenialScenarioResult> {
  if (!isNetworkDenialHost(host)) throw new Error('unknown_host');
  const denied = rejectPlatformCall(host);
  const durable = await writeAndRestart(host);
  const batchReplayed = await replayBatchLater(
    durable.store,
    durable.destination,
    durable.deviceId,
    host,
    denied.count,
  );
  const restored = await durable.store.read((tx) =>
    tx.get<{ title: string; host: NetworkDenialHost }>('ticket', durable.write.id),
  );
  const pending = await durable.store.read((tx) => tx.pending(durable.destination));
  const event = pending.find((row) => row.clientEntityId === durable.write.id);
  if (
    !restored
    || restored.payload.host !== host
    || restored.payload.title !== durable.write.title
    || event?.eventId !== durable.write.eventId
  ) {
    throw new Error('write_lost_after_replay');
  }
  const readAfterRestart: NetworkDenialWrite = {
    id: restored.id,
    eventId: event.eventId,
    entityType: 'ticket',
    title: restored.payload.title,
    host: restored.payload.host,
  };
  return {
    host,
    networkDenied: true,
    platformCallRejected: denied.rejected,
    platformCallPerformed: denied.performed,
    platformCallCount: denied.count,
    deniedCall: denied.deniedCall,
    write: durable.write,
    restarted: true,
    secondStoreRead: true,
    readAfterRestart,
    batchReplayed,
    closesG27: false,
  };
}

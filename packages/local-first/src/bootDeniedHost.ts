/**
 * THE denied-network host boot — one primitive for the Web, VSIX, and Rovr hosts.
 *
 * Each host used to carry its own copy of the same boot: a deny probe through a
 * counting transport, a `stopped` flag, and a `replayBatch` that seals one
 * pending batch into a LOCAL replay receipt instead of calling the platform.
 * Three copies had already drifted (three batch rules, three receipt shapes).
 * This module is that boot once; a host supplies only what genuinely differs:
 * where its pending work lives and where its receipts are kept.
 *
 *   - DENY PROBE. `ready()` sends one synthetic sync push through the guarded
 *     fetch while `synchronize` is refused. It must throw `PlatformAccessDenied`
 *     before the transport runs; a transport call is `platform_fetch_ran`.
 *   - LOCAL REPLAY. `replayBatch()` never calls the platform. It takes the first
 *     pending group no receipt covers yet, writes one receipt for it, and
 *     returns its idempotency key. The pending rows stay, so a later granted
 *     sync still sends the same events. With nothing uncovered it returns
 *     `count: 0` and the key of the latest receipt.
 *
 * Also here: the durable local-ticket write/read the Web and VSIX boots share,
 * and the receipt store over a `LocalFirstStore` both of them use. Rovr keeps
 * its receipts in its own outbox partition and passes its own ports.
 *
 * This module opens nothing and calls no network on its own.
 */

import {
  LOCAL_FIRST_POLICY,
  PlatformAccessDenied,
  createGuardedPlatformFetch,
  type PlatformPolicy,
} from './policy.js';
import { newLocalRecord, type LocalFirstStore } from './store.js';

/** One pending row a replay may seal. `group` is the unit one receipt covers. */
export interface DeniedReplayEntry {
  readonly id: string;
  readonly group: string;
  /** The key a receipt for this row's group is written under. Defaults to `id`. */
  readonly idempotencyKey?: string;
}

/** One batch replayed on this device. Not a platform acknowledgement. */
export interface DeniedReplayReceipt {
  readonly idempotencyKey: string;
  readonly count: number;
  readonly ids: readonly string[];
}

export interface DeniedReplayResult {
  count: number;
  idempotencyKey: string;
}

export interface DeniedReplayPorts {
  /** Pending rows, oldest first. */
  pending(): Promise<readonly DeniedReplayEntry[]>;
  /** Every receipt this device wrote, oldest first. */
  receipts(): Promise<readonly DeniedReplayReceipt[]>;
  putReceipt(receipt: DeniedReplayReceipt): Promise<void>;
}

/** Seal the first uncovered pending group into one local receipt. Never calls the platform. */
export async function replayDeniedBatch(ports: DeniedReplayPorts): Promise<DeniedReplayResult> {
  const receipts = await ports.receipts();
  const covered = new Set(receipts.flatMap((receipt) => receipt.ids));
  const uncovered = (await ports.pending()).filter((entry) => !covered.has(entry.id));
  const first = uncovered[0];
  if (!first) {
    return { count: 0, idempotencyKey: receipts[receipts.length - 1]?.idempotencyKey ?? '' };
  }
  const batch = uncovered.filter((entry) => entry.group === first.group);
  const idempotencyKey = first.idempotencyKey ?? first.id;
  await ports.putReceipt({ idempotencyKey, count: batch.length, ids: batch.map((entry) => entry.id) });
  return { count: batch.length, idempotencyKey };
}

export interface BootDeniedHostOptions extends DeniedReplayPorts {
  readonly network: 'denied';
  readonly policy: PlatformPolicy;
  /** The platform transport. Counted; never called while the network is denied. */
  readonly transport?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Host readiness (open the store, read the stored policy). Awaited before the probe. */
  readonly open?: () => Promise<void>;
  /** Host-specific error codes, so each host keeps its own vocabulary. */
  readonly errors?: { readonly notDenied?: string; readonly stopped?: string };
  readonly onStop?: () => void;
}

export interface DeniedHostBoot {
  ready(): Promise<void>;
  /** Throws the host's `stopped` error after `stop()`. */
  assertOpen(): void;
  replayBatch(): Promise<DeniedReplayResult>;
  /** Transport calls made so far. Zero for the life of a denied host. */
  transportCalls(): number;
  stop(): void;
}

const DENY_PROBE_URL = 'https://platform.invalid/api/sync/v1/push';

export function bootDeniedHost(options: BootDeniedHostOptions): DeniedHostBoot {
  const notDenied = options.errors?.notDenied ?? 'network_not_denied';
  const stoppedError = options.errors?.stopped ?? 'denied_host_stopped';
  if (options.network !== 'denied') throw new Error(notDenied);
  let stopped = false;
  let calls = 0;
  let probed: Promise<void> | undefined;
  const transport = options.transport
    ?? ((input: string, init?: RequestInit) => globalThis.fetch(input, init));
  const guarded = createGuardedPlatformFetch({
    policy: options.policy,
    fetch: async (input, init) => {
      calls += 1;
      return transport(input, init);
    },
  });

  const assertOpen = (): void => {
    if (stopped) throw new Error(stoppedError);
  };

  const assertNoTransport = (): void => {
    if (calls !== 0) throw new Error('platform_fetch_ran');
  };

  /** One synthetic sync push. A refused `synchronize` must throw before the transport. */
  const probe = async (): Promise<void> => {
    const deniedDefault = options.policy.snapshot().synchronize === LOCAL_FIRST_POLICY.synchronize
      && !options.policy.allows('synchronize');
    if (!deniedDefault) return;
    try {
      await guarded(DENY_PROBE_URL, { method: 'POST' }, 'synchronize');
    } catch (error) {
      if (!(error instanceof PlatformAccessDenied)) throw error;
      assertNoTransport();
      return;
    }
    throw new Error('platform_call_performed');
  };

  const ready = async (): Promise<void> => {
    assertOpen();
    await options.open?.();
    probed ??= probe().catch((error: unknown) => {
      probed = undefined;
      throw error;
    });
    await probed;
  };

  return {
    ready,
    assertOpen,
    async replayBatch() {
      await ready();
      // Denied network: a local receipt only. Calling `guarded` here would be a
      // platform attempt; the probe already proved the guard refuses first.
      assertNoTransport();
      return replayDeniedBatch(options);
    },
    transportCalls: () => calls,
    stop() {
      stopped = true;
      options.onStop?.();
    },
  };
}

// ---------------------------------------------------------------------------
// Shared by the hosts whose durable store is a LocalFirstStore (Web, VSIX)
// ---------------------------------------------------------------------------

export interface LocalTicket {
  id: string;
  title: string;
}

/**
 * Write one local ticket and its create event in one transaction. Does not fetch.
 * The store mints the event's wire id; `idempotencyKeyFor` names the logical write
 * (`ticket:<id>:v1`) so a repeated enqueue dedupes and a replay receipt carries it.
 */
export async function recordLocalTicket(
  store: LocalFirstStore,
  input: { title: string; id?: string },
  options: { deviceId: string; idempotencyKeyFor: (id: string) => string; now?: () => Date; invalidTitle?: string },
): Promise<string> {
  const title = input.title.trim();
  if (!title) throw new Error(options.invalidTitle ?? 'ticket_title_required');
  const id = input.id ?? crypto.randomUUID();
  const occurredAt = (options.now?.() ?? new Date()).toISOString();
  const record = newLocalRecord({ id, entityType: 'ticket', payload: { title }, deviceId: options.deviceId, occurredAt });
  await store.transact(async (tx) => {
    await tx.put(record);
    await tx.append({
      idempotencyKey: options.idempotencyKeyFor(id),
      clientEntityId: id,
      entityType: 'ticket',
      operation: 'create',
      schemaVersion: record.schemaVersion,
      occurredAt,
      dependsOn: [],
      destination: record.destination,
      payload: record.payload,
    });
  });
  return id;
}

/** Read a live local ticket back. A deleted or untitled row is absent. */
export async function readLocalTicket(store: LocalFirstStore, id: string): Promise<LocalTicket | undefined> {
  const row = await store.read((tx) => tx.get<{ title?: unknown }>('ticket', id));
  if (!row || row.deletedAt) return undefined;
  const title = row.payload.title;
  if (typeof title !== 'string' || !title.trim()) return undefined;
  return { id: row.id, title };
}

interface StoredReceipt extends DeniedReplayReceipt {
  kind: string;
}

/**
 * Replay ports over a `LocalFirstStore`: pending journal events grouped by
 * entity, receipts kept as local `memory-fact` rows of `kind` with no journal
 * event — a receipt never syncs.
 */
export function localFirstStoreReplayPorts(
  store: LocalFirstStore,
  options: { kind: string; deviceId: string; now?: () => Date },
): DeniedReplayPorts {
  return {
    async pending() {
      const events = await store.read((tx) => tx.pending());
      return events.map((event) => ({
        id: event.eventId,
        group: event.clientEntityId,
        ...(event.idempotencyKey !== undefined ? { idempotencyKey: event.idempotencyKey } : {}),
      }));
    },
    async receipts() {
      const rows = await store.read((tx) => tx.list<Partial<StoredReceipt>>('memory-fact'));
      return rows
        .filter((row) => !row.deletedAt && row.payload.kind === options.kind)
        .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
        .map((row) => ({
          idempotencyKey: String(row.payload.idempotencyKey ?? ''),
          count: Number(row.payload.count ?? 0),
          ids: Array.isArray(row.payload.ids) ? row.payload.ids.filter((id): id is string => typeof id === 'string') : [],
        }));
    },
    async putReceipt(receipt) {
      const record = newLocalRecord<StoredReceipt>({
        id: `replay:${receipt.idempotencyKey}`,
        entityType: 'memory-fact',
        payload: { kind: options.kind, ...receipt, ids: [...receipt.ids] },
        deviceId: options.deviceId,
        occurredAt: (options.now?.() ?? new Date()).toISOString(),
      });
      await store.transact(async (tx) => {
        await tx.put(record);
      });
    },
  };
}

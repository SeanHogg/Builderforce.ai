/**
 * The NETWORK half of local-first: every Rovr write that has to reach the platform —
 * a chat's messages and step rows, a task the chat produced — goes through ONE durable
 * write outbox (`@builderforce/write-outbox`), one lane per local chat.
 *
 *   - DURABLE: queued in IndexedDB (`builderforce-outbox:rovr`, one partition), retried
 *     with backoff, kept across the service worker being put to sleep or the browser
 *     restarting. A 4xx refusal is dropped; anything without an answer is retried.
 *   - OFFLINE: driven by the browser's `online`/`offline` events — nothing is attempted
 *     while offline and every lane replays the moment the connection returns.
 *   - SCOPED: `tenant:<id>`. A write made in one workspace is never replayed into
 *     another; a write made signed out waits, unscoped, for the next sign-in.
 *   - ORDERED: one request in flight per chat, so the chat is created before its first
 *     message, and its messages arrive in the order they were written.
 *   - IDEMPOTENT: each message row carries an `eventKey` minted from its outbox entry id
 *     (the server's `uq_brain_chat_messages_event` writes a replay once). The chat create,
 *     the task create and the task link each carry a stable `Idempotency-Key` (the chat's
 *     `syncKey`, the task's id, the link's outbox entry id) — all three routes replay the
 *     first answer — and each platform id is recorded locally the moment it answers, so a
 *     later retry does not even ask.
 *
 * The service worker is the ONLY owner of this outbox (two contexts draining one store
 * would race); the side panel hands it items over `chrome.runtime` messages.
 */
import { destinationKey, type EntityDestination } from '@builderforce/local-first';
import { createOutbox, type Outbox, type OutboxOnlineSignal, type OutboxSendContext, type OutboxStore } from '@builderforce/write-outbox';
import type { ApiClient } from '../api/apiClient';
import type { MessageInput, RovrRecords } from '../store/records';

/**
 * One queued write, keyed by its LOCAL chat id.
 * A task item carries the destination snapshotted at enqueue (G11). Send reads that
 * snapshot. A later Settings change is not a rebind — rebind is an explicit write of
 * `projectId` on the task record, never a side effect of `taskProjectId()`.
 */
export type SyncItem =
  | { kind: 'message'; row: MessageInput }
  | { kind: 'task'; taskId: string; projectId?: number | null; destinationKey?: string };

/** Destination pinned onto a queued task. `null` stays on this device. */
interface TaskSnapshot {
  projectId: number | null;
  destinationKey: string;
}

export interface ChatSyncDeps {
  api: ApiClient;
  records: RovrRecords;
  store: OutboxStore<SyncItem, number>;
  online: OutboxOnlineSignal;
  scope(): string | null;
  /**
   * The live Settings project. Consulted only to pin a task that has no snapshot yet,
   * and only at enqueue (or the first send of a pre-snapshot row). Never a rebind.
   */
  taskProjectId(): Promise<number | null>;
  onError?(error: unknown): void;
}

/** Rows per request — the step outbox's batch size, so a batch never grows past it. */
export const SYNC_BATCH_MAX = 25;
/** The longest a queued write waits for company before it leaves. */
export const SYNC_BATCH_WAIT_MS = 2_000;

/** Platform chat id for a local chat — created once, then remembered on the chat. */
async function ensureServerChat(deps: ChatSyncDeps, localId: number, scope: string | undefined): Promise<number> {
  const chat = await deps.records.getChat(localId);
  if (!chat) throw Object.assign(new Error(`unknown local chat ${localId}`), { status: 410 });
  if (chat.serverId) return chat.serverId;
  const created = await deps.api.request<{ id: number }>('/api/brain/chats', {
    method: 'POST',
    json: {
      title: chat.title,
      mode: chat.mode ?? 'chat',
      // The first prompt, when the seam captured it before the chat reached the platform
      // (migration 1245). Carried in the CREATE so a create that races the first turn —
      // or replays from the outbox after the reply was lost — still lands the request;
      // the server writes it once and ignores it afterwards. Omitted when absent so an
      // old device row sends exactly what it sent before.
      ...(chat.originalRequest ? { originalRequest: chat.originalRequest } : {}),
    },
    idempotencyKey: `rovr-chat:${chat.syncKey}`,
    ...(scope !== undefined ? { asScope: scope } : {}),
  });
  // Memory switched off before the chat reached the platform: the platform chat starts
  // on (the column default), so carry the device's choice across. Best-effort — the
  // device record stays the source of truth and the panel re-sends on the next toggle.
  if (chat.memoryEnabled === false) {
    await deps.api
      .request(`/api/brain/chats/${created.id}`, { method: 'PATCH', json: { memoryEnabled: false }, ...(scope !== undefined ? { asScope: scope } : {}) })
      .catch(() => undefined);
  }
  await deps.records.updateChat(localId, { serverId: created.id });
  return created.id;
}

type TaskSyncItem = Extract<SyncItem, { kind: 'task' }>;

function snapshotOf(projectId: number | null): TaskSnapshot {
  const destination: EntityDestination = projectId === null ? { kind: 'unbound' } : { kind: 'bound', projectId: String(projectId) };
  return { projectId, destinationKey: destinationKey(destination) };
}

function stamp(item: TaskSyncItem, snap: TaskSnapshot): TaskSnapshot {
  item.projectId = snap.projectId;
  item.destinationKey = snap.destinationKey;
  return snap;
}

/**
 * Pins a task's destination. A `projectId` already on the record or the queued item
 * wins — the live Settings lookup is not applied over it (that would be a rebind).
 * The lookup promise is started by the caller BEFORE this awaits, so a Settings
 * change after enqueue cannot be the value observed for an unsnapshotted row.
 */
async function pinTaskDestination(deps: ChatSyncDeps, item: TaskSyncItem, live: Promise<number | null> | undefined): Promise<TaskSnapshot> {
  const task = await deps.records.getTask(item.taskId);
  if (task && task.projectId !== undefined) return stamp(item, snapshotOf(task.projectId));
  if (item.projectId !== undefined) {
    const snap = stamp(item, snapshotOf(item.projectId));
    if (task) await deps.records.putTask({ ...task, projectId: snap.projectId });
    return snap;
  }
  const projectId = live ? await live : null;
  const current = await deps.records.getTask(item.taskId);
  // An explicit write landed while the lookup was in flight. Do not overwrite it.
  if (current && current.projectId !== undefined) return stamp(item, snapshotOf(current.projectId));
  const snap = stamp(item, snapshotOf(projectId));
  if (current) await deps.records.putTask({ ...current, projectId: snap.projectId });
  return snap;
}

async function syncTask(
  deps: ChatSyncDeps,
  serverChatId: number,
  item: TaskSyncItem,
  linkKey: string,
  scope: string | undefined,
  destination: Promise<TaskSnapshot>,
): Promise<void> {
  const snap = await destination;
  const task = await deps.records.getTask(item.taskId);
  if (!task || task.state === 'synced') return;
  // The record's snapshot wins over the pin, so an explicit rebind after enqueue is
  // kept and a live lookup cannot move a row that already has a destination.
  const projectId = task.projectId !== undefined ? task.projectId : snap.projectId;
  if (task.projectId === undefined) await deps.records.putTask({ ...task, projectId });
  const filed = (await deps.records.getTask(item.taskId)) ?? { ...task, projectId };
  if (projectId === null) {
    // No project to file it in: it stays a task on this device (the panel says so).
    if (filed.state !== 'local' || filed.projectId !== null) await deps.records.putTask({ ...filed, projectId: null, state: 'local' });
    return;
  }
  const asScope = scope !== undefined ? { asScope: scope } : {};
  let serverTaskId = filed.serverTaskId;
  if (serverTaskId === undefined) {
    const created = await deps.api.request<{ id: number }>('/api/tasks', {
      method: 'POST',
      json: { projectId, title: filed.title, ...(filed.description ? { description: filed.description } : {}) },
      idempotencyKey: `rovr-task-create:${filed.id}`,
      ...asScope,
    });
    serverTaskId = created.id;
    // Recorded BEFORE the link: a retry of the link never creates the task twice.
    await deps.records.putTask({ ...filed, projectId, serverTaskId });
  }
  await deps.api.request(`/api/brain/chats/${serverChatId}/tickets`, {
    method: 'POST',
    json: { kind: 'task', ref: serverTaskId, linkType: 'created' },
    idempotencyKey: linkKey,
    ...asScope,
  });
  await deps.records.putTask({ ...filed, projectId, serverTaskId, state: 'synced' });
}

/**
 * The chat outbox plus a CHANGE signal: `subscribe` hears every change to its
 * {@link Outbox.stats} — an enqueue, a batch going out or settling, a drop, the durable
 * store loading its backlog — so whoever shows "waiting to sync" reacts to the queue
 * instead of polling it. Coalesced to one call per task (a burst of enqueues is one).
 */
export interface ChatSync extends Outbox<SyncItem, number> {
  subscribe(listener: () => void): () => void;
}

export function createChatSync(deps: ChatSyncDeps): ChatSync {
  const listeners = new Set<() => void>();
  let pending = false;
  // Deferred to the next task: the outbox updates its counters around `send` (and after
  // `onError`) in microtasks of its own, so a listener reads the settled numbers.
  const changed = (): void => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      for (const listener of [...listeners]) listener();
    }, 0);
  };
  // One pin per task id, started at enqueue so send never re-reads Settings.
  const pins = new Map<string, Promise<TaskSnapshot>>();
  const resolveDestination = (item: TaskSyncItem): Promise<TaskSnapshot> => {
    const existing = pins.get(item.taskId);
    if (existing) return existing;
    // Start the live read NOW, before any await, and only when this queued item has
    // no snapshot of its own. pinTaskDestination discards it if the record already
    // has one — a lookup is not a rebind.
    const live = item.projectId === undefined ? deps.taskProjectId() : undefined;
    const job = pinTaskDestination(deps, item, live);
    pins.set(item.taskId, job);
    return job;
  };
  const outbox = createOutbox<SyncItem, number>({
    maxItems: SYNC_BATCH_MAX,
    maxWaitMs: SYNC_BATCH_WAIT_MS,
    retry: {},
    store: deps.store,
    online: deps.online,
    scope: deps.scope,
    onError: (error) => {
      changed();
      deps.onError?.(error);
    },
    onDrop: changed,
    async send(localChatId, items, ctx) {
      changed();
      try {
        await sendBatch(deps, localChatId, items, ctx, resolveDestination);
      } finally {
        changed();
      }
    },
  });
  void outbox.ready().then(changed, () => undefined);
  return {
    ...outbox,
    enqueue(key, item) {
      if (item.kind === 'task') void resolveDestination(item);
      const id = outbox.enqueue(key, item);
      changed();
      return id;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Send one batch of a local chat's queue: the chat first, then its rows and tasks in order. */
async function sendBatch(
  deps: ChatSyncDeps,
  localChatId: number,
  items: SyncItem[],
  ctx: OutboxSendContext,
  destinationFor: (item: TaskSyncItem) => Promise<TaskSnapshot>,
): Promise<void> {
  const serverChatId = await ensureServerChat(deps, localChatId, ctx.scope);
  // Consecutive message rows travel together; a task is sent in its place in order.
  let rows: Array<MessageInput & { eventKey: string }> = [];
  const flushRows = async () => {
    if (rows.length === 0) return;
    const batch = rows;
    rows = [];
    await deps.api.request(`/api/brain/chats/${serverChatId}/messages`, {
      method: 'POST',
      json: { messages: batch },
      // Replay-safe through each row's `eventKey`, not a request key: one batch can
      // carry several row groups (split by a task), which must not share one.
      ...(ctx.scope !== undefined ? { asScope: ctx.scope } : {}),
    });
  };
  for (const [i, item] of items.entries()) {
    const entryId = ctx.ids[i] ?? `${ctx.idempotencyKey}:${i}`;
    if (item.kind === 'message') {
      // The row's own key when it has one (the server upserts on it, so a late save and its retry are one row);
      // otherwise the outbox entry's.
      rows.push({ ...item.row, eventKey: item.row.eventKey ?? `rovr:${entryId}` });
      continue;
    }
    await flushRows();
    await syncTask(deps, serverChatId, item, `rovr-task:${entryId}`, ctx.scope, destinationFor(item));
  }
  await flushRows();
}

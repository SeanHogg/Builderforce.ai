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
import { createOutbox, type Outbox, type OutboxOnlineSignal, type OutboxStore } from '@builderforce/write-outbox';
import type { ApiClient } from '../api/apiClient';
import type { MessageInput, RovrRecords } from '../store/records';

/** One queued write, keyed by its LOCAL chat id. */
export type SyncItem =
  | { kind: 'message'; row: MessageInput }
  | { kind: 'task'; taskId: string };

export interface ChatSyncDeps {
  api: ApiClient;
  records: RovrRecords;
  store: OutboxStore<SyncItem, number>;
  online: OutboxOnlineSignal;
  scope(): string | null;
  /** The project tasks are filed in (Settings); null keeps tasks on this device. */
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
    json: { title: chat.title, mode: chat.mode ?? 'chat' },
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

async function syncTask(deps: ChatSyncDeps, serverChatId: number, taskId: string, linkKey: string, scope: string | undefined): Promise<void> {
  const task = await deps.records.getTask(taskId);
  if (!task || task.state === 'synced') return;
  const projectId = await deps.taskProjectId();
  if (projectId === null) {
    // No project to file it in: it stays a task on this device (the panel says so).
    await deps.records.putTask({ ...task, state: 'local' });
    return;
  }
  const asScope = scope !== undefined ? { asScope: scope } : {};
  let serverTaskId = task.serverTaskId;
  if (serverTaskId === undefined) {
    const created = await deps.api.request<{ id: number }>('/api/tasks', {
      method: 'POST',
      json: { projectId, title: task.title, ...(task.description ? { description: task.description } : {}) },
      idempotencyKey: `rovr-task-create:${task.id}`,
      ...asScope,
    });
    serverTaskId = created.id;
    // Recorded BEFORE the link: a retry of the link never creates the task twice.
    await deps.records.putTask({ ...task, serverTaskId });
  }
  await deps.api.request(`/api/brain/chats/${serverChatId}/tickets`, {
    method: 'POST',
    json: { kind: 'task', ref: serverTaskId, linkType: 'created' },
    idempotencyKey: linkKey,
    ...asScope,
  });
  await deps.records.putTask({ ...task, serverTaskId, state: 'synced' });
}

export function createChatSync(deps: ChatSyncDeps): Outbox<SyncItem, number> {
  return createOutbox<SyncItem, number>({
    maxItems: SYNC_BATCH_MAX,
    maxWaitMs: SYNC_BATCH_WAIT_MS,
    retry: {},
    store: deps.store,
    online: deps.online,
    scope: deps.scope,
    ...(deps.onError ? { onError: deps.onError } : {}),
    async send(localChatId, items, ctx) {
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
          rows.push({ ...item.row, eventKey: `rovr:${entryId}` });
          continue;
        }
        await flushRows();
        await syncTask(deps, serverChatId, item.taskId, `rovr-task:${entryId}`, ctx.scope);
      }
      await flushRows();
    },
  });
}

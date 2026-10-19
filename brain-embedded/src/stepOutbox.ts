/**
 * stepOutbox — the run's durable step rows, sent in batches instead of one POST each.
 *
 * Every tool call, LLM turn and memory step a run takes is persisted as a `role:'tool'`
 * message (see `persistedSteps.ts`). Sent one at a time that was a full
 * `POST /chats/:id/messages` per step — measured on chat #142: 57 tool calls over 22
 * turns, ~80 requests, each costing the API an access check, a membership upsert, the
 * insert, the seq update, the chat touch and a learn-gate read. The endpoint writes an
 * ARRAY in one insert; nothing about a step row needs its own request.
 *
 * So step rows go through the shared write outbox (`@builderforce/write-outbox`), one
 * lane per chat, and leave:
 *   - riding along with the next conversational send for that chat (assistant text, a
 *     stopped turn, a run failure) — the same request, zero extra calls;
 *   - when {@link STEP_BATCH_MAX} rows are queued;
 *   - {@link STEP_BATCH_WAIT_MS} after the first queued row, at the latest;
 *   - when the run ends ({@link StepBatchingPersistence.flush}).
 *
 * ORDER holds by construction: a chat's lane has one request in flight at a time, and a
 * conversational send waits its turn in that lane, so nothing it writes can overtake a
 * step batch already on the wire.
 *
 * DURABLE: the outbox runs in its durable mode. A step batch that fails to send (offline,
 * a redeploy, a dropped connection) is kept at the head of its chat's lane and retried
 * with backoff — or the moment the host's `online` signal comes back — instead of being
 * dropped; a failed conversational send hands its piggybacked rows back to the lane and
 * still throws to its caller. Only a batch the server REFUSED (a 4xx) is dropped. Every
 * row carries an `eventKey` minted from its outbox entry id, so a replay of a batch the
 * server already wrote is recognised (`uq_brain_chat_messages_event`) and writes nothing
 * twice. With a host `store` the queue also survives a restart.
 */

import {
  createOutbox,
  type OutboxOnlineSignal,
  type OutboxSendPermission,
  type OutboxStore,
} from '@builderforce/write-outbox';
import type { BrainMessage } from './types';

/** A row as the step outbox queues and persists it. */
export type StepOutgoingMessage = { role: string; content: string; metadata?: string; eventKey?: string };
type OutgoingMessage = StepOutgoingMessage;

/** The persistence port this wraps — the slice of `BrainRunPersistence` it needs. */
export interface StepPersistence {
  /** `opts.scope` = the identity a queued batch was written under (outbox `scope`); a
   *  sender that can act as several identities must send AS it, or fail. */
  sendMessages(chatId: number, messages: OutgoingMessage[], opts?: { scope?: string }): Promise<BrainMessage[]>;
}

export interface StepBatchingPersistence<P extends StepPersistence> {
  readonly persistence: P;
  /** Send every queued step row now (all chats). Never throws. */
  flush(): Promise<void>;
}

/** Rows per batch before it leaves without waiting. A step row is capped at ~4 KB. */
export const STEP_BATCH_MAX = 25;
/** The longest a queued step row waits for a ride. */
export const STEP_BATCH_WAIT_MS = 5_000;

/** A step row: the only `role:'tool'` message a run persists. */
const isStepRow = (m: OutgoingMessage): boolean => m.role === 'tool';

export interface StepBatchingOptions {
  maxRows?: number;
  waitMs?: number;
  /** Where queued rows live (default: memory — retried for the life of the process). */
  store?: OutboxStore<OutgoingMessage, number>;
  /** The host's connectivity: rows wait while offline and replay on reconnect. */
  online?: OutboxOnlineSignal;
  /** The identity rows are sent as (e.g. tenant); rows queued under another are parked. */
  scope?(): string | null;
  /** Administrative permission, independent of network reachability. */
  sendPermission?: OutboxSendPermission;
}

/**
 * How a HOST makes step rows work fully offline: where each queue is stored, the host's
 * connectivity + identity, and a RUN-INDEPENDENT sender. Installed once by the host (the
 * web app over IndexedDB, the VS Code extension host over its workspace state).
 *
 * With `sendRows` + `storedKeys`, every stored queue is drained on install (startup) and
 * again whenever the host comes back online — no run in that chat is needed, because a
 * step row is just a POST to its chat's messages endpoint (idempotent on `eventKey`).
 * Without durability a run's rows are still retried, for the life of the process.
 */
export interface StepDurability {
  /** The store for one queue. `key` names the chat (and, for a sub-agent, its run). */
  storeFor(key: string): OutboxStore<StepOutgoingMessage, number>;
  /** Every key that currently holds a stored queue. */
  storedKeys?(): Promise<string[]> | string[];
  /** POST rows to a chat (the base persistence port), AS `scope` when given. Throws on
   *  failure, with the HTTP `status` when there was one (a 4xx is dropped). */
  sendRows?(chatId: number, rows: StepOutgoingMessage[], scope?: string): Promise<unknown>;
  online?: OutboxOnlineSignal;
  scope?(): string | null;
  /** Administrative permission, independent of network reachability. */
  sendPermission?: OutboxSendPermission;
}

let durability: StepDurability | null = null;
/** One store per key, shared by every queue of that key in this process. */
const stores = new Map<string, OutboxStore<StepOutgoingMessage, number>>();
/** Keys a live run's outbox owns — that outbox replays them itself. */
const runKeys = new Set<string>();
/** Run-independent replay queues, one per drained key. */
const replays = new Map<string, StepBatchingPersistence<StepPersistence>>();
let stopListening: (() => void) | null = null;

/** Install (or with `null`, remove) the host's step durability, and drain what is stored. */
export function installStepDurability(next: StepDurability | null): void {
  stopListening?.();
  stopListening = null;
  durability = next;
  stores.clear();
  runKeys.clear();
  replays.clear();
  if (!next) return;
  const stopOnline = next.online?.subscribe((online) => {
    if (online) void drainStoredSteps();
  });
  const stopPermission = next.sendPermission?.subscribe((allowed) => {
    if (allowed) void drainStoredSteps();
  });
  stopListening = () => {
    stopOnline?.();
    stopPermission?.();
  };
  void drainStoredSteps();
}

const optionsFor = (d: StepDurability, key: string): StepBatchingOptions => {
  let store = stores.get(key);
  if (!store) {
    store = d.storeFor(key);
    stores.set(key, store);
  }
  return {
    store,
    ...(d.online ? { online: d.online } : {}),
    ...(d.scope ? { scope: d.scope } : {}),
    ...(d.sendPermission ? { sendPermission: d.sendPermission } : {}),
  };
};

/**
 * The step-outbox options for one run under the installed durability. Keyed per CHAT; a
 * sub-agent (its own run key inside its owner's chat) gets its own queue in that chat.
 */
export function stepDurabilityFor(chatId: number, runKey: number): StepBatchingOptions {
  if (!durability) return {};
  const key = runKey === chatId ? `chat:${chatId}` : `chat:${chatId}:run:${runKey}`;
  runKeys.add(key);
  return optionsFor(durability, key);
}

/**
 * Send every stored step queue that no live run owns, through the host's run-independent
 * sender. Rows replay to the chat they were queued for (a sub-agent's to its owner's
 * chat), in order, under their original `eventKey`s. Never throws; a queue that cannot be
 * sent yet stays stored and keeps retrying.
 */
export async function drainStoredSteps(): Promise<void> {
  const d = durability;
  if (!d?.sendRows || !d.storedKeys || d.sendPermission?.isAllowed() === false) return;
  const sendRows = d.sendRows;
  let keys: string[];
  try {
    keys = await d.storedKeys();
  } catch {
    return;
  }
  await Promise.all(keys.filter((key) => !runKeys.has(key)).map((key) => {
    let replay = replays.get(key);
    if (!replay) {
      replay = batchStepPersistence({
        async sendMessages(chatId, rows, opts) {
          await sendRows(chatId, rows, opts?.scope);
          return [];
        },
      }, optionsFor(d, key));
      replays.set(key, replay);
    }
    return replay.flush();
  }));
}

/** Stamp each row with its outbox entry's id as the server's idempotency `eventKey`. */
const withEventKeys = (rows: OutgoingMessage[], ids: readonly string[]): OutgoingMessage[] =>
  rows.map((m, i) => (m.eventKey || !ids[i] ? m : { ...m, eventKey: `step:${ids[i]}` }));

export function batchStepPersistence<P extends StepPersistence>(
  base: P,
  opts: StepBatchingOptions = {},
): StepBatchingPersistence<P> {
  const steps = createOutbox<OutgoingMessage, number>({
    maxItems: opts.maxRows ?? STEP_BATCH_MAX,
    maxWaitMs: opts.waitMs ?? STEP_BATCH_WAIT_MS,
    retry: {},
    ...(opts.store ? { store: opts.store } : {}),
    ...(opts.online ? { online: opts.online } : {}),
    ...(opts.scope ? { scope: opts.scope } : {}),
    ...(opts.sendPermission ? { sendPermission: opts.sendPermission } : {}),
    send: (chatId, rows, ctx) =>
      base.sendMessages(chatId, withEventKeys(rows, ctx.ids), ctx.scope !== undefined ? { scope: ctx.scope } : undefined),
  });

  const sendMessages = async (chatId: number, messages: OutgoingMessage[]): Promise<BrainMessage[]> => {
    if (messages.length > 0 && messages.every(isStepRow)) {
      for (const m of messages) steps.enqueue(chatId, m);
      // Nobody reads a step row's saved copy back (it never enters the live list).
      return [];
    }
    // One request, in the chat's order: the queued steps first, then the caller's own
    // messages — whose saved rows (one per input, in order) are what the caller gets.
    return steps.drainWith(chatId, async (pending, ctx) => {
      if (pending.length === 0) return base.sendMessages(chatId, messages);
      const saved = await base.sendMessages(chatId, [...withEventKeys(pending, ctx.ids), ...messages]);
      return saved.slice(pending.length);
    });
  };

  return {
    persistence: { ...base, sendMessages },
    flush: () => steps.flush(),
  };
}

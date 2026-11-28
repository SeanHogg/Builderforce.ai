/**
 * The local chat's ROWS — what a host's local store holds for one Brain chat, and the
 * one way every module of the local chat (persistence, identity, the run usage ledger,
 * sync) reads them. A chat is a `chat` record (its view key `chat.id`, its stable client
 * id the record id), its turns are `message` records, and each model call a run made in
 * it is a `usage` record (`usageLedger.ts`).
 *
 * Rows another device synced into this store (PRD 36 pull) are not this device's chats:
 * their view keys were minted on that device and collide with this one's, so they are
 * left out of every read here.
 */

import {
  defineRecordIndex,
  defineRecordPartition,
  isLiveOwnStub,
  isOwnRecord,
  SCAN_STOP,
  scanByIndex,
  selectRecords,
  type LocalFirstTransaction,
  type LocalRecord,
  type RecordStub,
  type ScanStop,
} from '@builderforce/local-first';
import type { BrainChat, BrainMessage } from '../types';
import type { RunUsageValue } from './usageLedger';

export interface ChatValue {
  clientId: string;
  chat: BrainChat;
}

export interface MessageValue {
  clientId: string;
  /** The chat's local view key. */
  chatId: number;
  /** The chat's client id (its record id). */
  chatClientId: string;
  eventKey: string;
  message: BrainMessage;
}

/** A live row of this device: not tombstoned, and written here (or this device's write pulled back). */
const isLiveOwn = (row: Readonly<LocalRecord>, deviceId: string): boolean => !row.deletedAt && isOwnRecord(row, deviceId);

/**
 * Visit this device's live rows of one type WITHOUT cloning them: a caller that only counts
 * or takes a maximum needs no copy. The rows are the store's own — never mutate or keep one.
 */
export function scanLive<T>(
  tx: LocalFirstTransaction,
  type: 'chat' | 'message' | 'usage' | 'run-outcome',
  deviceId: string,
  visit: (row: Readonly<LocalRecord<T>>) => void,
): Promise<void> {
  return tx.scan<T>(type, (row) => {
    if (isLiveOwn(row, deviceId)) visit(row);
  });
}

/**
 * This device's live rows of one type, cloned — only those `where` keeps. Reading one chat's
 * messages out of every chat's costs that chat, not the whole history.
 */
export function liveRecords<T>(
  tx: LocalFirstTransaction,
  type: 'chat' | 'message' | 'usage' | 'run-outcome',
  deviceId: string,
  where?: (row: Readonly<LocalRecord<T>>) => boolean,
): Promise<LocalRecord<T>[]> {
  return selectRecords<T>(tx, type, (row) => isLiveOwn(row, deviceId) && (!where || where(row)));
}

/**
 * THE index of message rows by their chat's view key (`MessageValue.chatId`). Reading one
 * chat's messages through it costs that chat's rows; without it every read walked every
 * message of every chat (75k rows on a real store, 0.2–0.8 s a read). Declared once here,
 * so every module of the local chat shares one built index per store.
 */
export const MESSAGES_BY_CHAT = defineRecordIndex<MessageValue>('message', 'brain.message.chatId', (row) => row.payload.chatId);

/**
 * Message rows live in ONE partition per chat (AE-G031), so a store with a loader reads a
 * chat's rows only when a read names that chat. Its home is `MESSAGES_BY_CHAT`'s key ignoring
 * `deletedAt` (a tombstoned message stays in its chat's partition); the stub carries the
 * message's view key as its ordinal, so an id is read without the row.
 */
export const MESSAGE_PARTITION = defineRecordPartition<MessageValue>({
  index: MESSAGES_BY_CHAT,
  homeOf: (row) => row.payload.chatId,
  ordinalOf: (row) => row.payload.message.id,
});

/**
 * Visit the stub of each of this device's LIVE messages without loading any partition. Resolves
 * `false` when the store has no stubs to give (no partitions, or a fake without `scanStubs`):
 * the caller then takes its row-scan path. The ONE place that decides "stubs, or rows".
 */
export async function scanLiveMessageStubs(
  tx: LocalFirstTransaction,
  deviceId: string,
  visit: (stub: Readonly<RecordStub>) => void | ScanStop,
): Promise<boolean> {
  if (!tx.scanStubs) return false;
  let any = false;
  await tx.scanStubs('message', (stub) => {
    any = true;
    if (isLiveOwnStub(stub, deviceId)) return visit(stub);
    return undefined;
  });
  return any;
}

/** The largest message view key this device holds (0 when none) — from stubs when the store has them. */
export async function highestMessageId(tx: LocalFirstTransaction, deviceId: string): Promise<number> {
  let highest = 0;
  const fromStubs = await scanLiveMessageStubs(tx, deviceId, (stub) => { highest = Math.max(highest, stub.ordinal ?? 0); });
  if (!fromStubs) await scanLive<MessageValue>(tx, 'message', deviceId, (row) => { highest = Math.max(highest, row.payload.message.id); });
  return highest;
}

/** Visit this device's live messages of ONE chat without cloning them (see `scanLive`). */
export function scanChatMessages(
  tx: LocalFirstTransaction,
  deviceId: string,
  chatId: number,
  visit: (row: Readonly<LocalRecord<MessageValue>>) => void,
): Promise<void> {
  return scanByIndex<MessageValue>(tx, MESSAGES_BY_CHAT, chatId, (row) => {
    if (isLiveOwn(row, deviceId)) visit(row);
  });
}

/**
 * THE index of run usage rows (`usageLedger.ts`) by their chat's client id. A chat list
 * page reads only its chats' ledger rows through it, never every chat's (15k rows on a
 * real store, walked on every `listChats`).
 */
export const USAGE_BY_CHAT = defineRecordIndex<RunUsageValue>('usage', 'brain.usage.clientChatId', (row) => row.payload.clientChatId);

/** Visit this device's live usage rows of ONE chat (by its client id) without cloning them. */
export function scanChatUsage(
  tx: LocalFirstTransaction,
  deviceId: string,
  clientChatId: string,
  visit: (row: Readonly<LocalRecord<RunUsageValue>>) => void,
): Promise<void> {
  return scanByIndex<RunUsageValue>(tx, USAGE_BY_CHAT, clientChatId, (row) => {
    if (isLiveOwn(row, deviceId)) visit(row);
  });
}

/** This device's live messages of ONE chat, cloned (order unspecified) — through the index. */
export async function chatMessageRecords(tx: LocalFirstTransaction, deviceId: string, chatId: number): Promise<LocalRecord<MessageValue>[]> {
  const rows: Readonly<LocalRecord<MessageValue>>[] = [];
  await scanChatMessages(tx, deviceId, chatId, (row) => { rows.push(row); });
  return structuredClone(rows) as LocalRecord<MessageValue>[];
}

/**
 * One chat's messages in `seq` order, cloned — the MESSAGES only, not their row envelopes
 * (a chat of 14k turns is ~27 MB; cloning the envelopes too is wasted work). `limit`: the
 * last `limit` of them, and only those are cloned.
 */
export async function chatMessagesInOrder(tx: LocalFirstTransaction, deviceId: string, chatId: number, limit?: number): Promise<BrainMessage[]> {
  const messages: BrainMessage[] = [];
  await scanChatMessages(tx, deviceId, chatId, (row) => { messages.push(row.payload.message); });
  messages.sort((a, b) => a.seq - b.seq);
  return structuredClone(limit != null ? messages.slice(-limit) : messages);
}

/**
 * Several chats' messages (each in `seq` order, cloned; an unknown chat maps to `[]`) as ONE
 * snapshot: a `scan`/`scanIndex` visit is synchronous and runs to completion inside its call,
 * so every chat's scan is STARTED before the first await — no commit can land between them.
 */
export async function chatsMessagesInOrder(tx: LocalFirstTransaction, deviceId: string, chatIds: readonly number[]): Promise<Map<number, BrainMessage[]>> {
  const out = new Map<number, BrainMessage[]>();
  const scans: Promise<void>[] = [];
  for (const chatId of chatIds) {
    if (out.has(chatId)) continue;
    const messages: BrainMessage[] = [];
    out.set(chatId, messages);
    scans.push(scanChatMessages(tx, deviceId, chatId, (row) => { messages.push(row.payload.message); }));
  }
  await Promise.all(scans);
  for (const [chatId, messages] of out) out.set(chatId, structuredClone(messages.sort((a, b) => a.seq - b.seq)));
  return out;
}

/**
 * This device's live message row with view key `messageId`, cloned. Given its chat, read through
 * that chat's index group; otherwise (or when the chat does not hold it) one walk of the
 * message rows that stops at the match.
 */
export async function messageRecordById(
  tx: LocalFirstTransaction,
  deviceId: string,
  messageId: number,
  chatId?: number,
): Promise<LocalRecord<MessageValue> | undefined> {
  let found: Readonly<LocalRecord<MessageValue>> | undefined;
  if (chatId !== undefined) {
    await scanChatMessages(tx, deviceId, chatId, (row) => { if (row.payload.message.id === messageId) found = row; });
  }
  if (!found) {
    // Stubs name the row without loading any partition; then one `get` reads just that row's chat.
    let stubId: string | undefined;
    const fromStubs = await scanLiveMessageStubs(tx, deviceId, (stub) => {
      if (stub.ordinal !== messageId) return undefined;
      stubId = stub.id;
      return SCAN_STOP;
    });
    if (fromStubs) {
      const row = stubId !== undefined ? await tx.get<MessageValue>('message', stubId) : undefined;
      return row && isLiveOwn(row, deviceId) ? row : undefined;
    }
    await tx.scan<MessageValue>('message', (row) => {
      if (row.payload.message.id !== messageId || !isLiveOwn(row, deviceId)) return undefined;
      found = row;
      return SCAN_STOP;
    });
  }
  return found ? (structuredClone(found) as LocalRecord<MessageValue>) : undefined;
}

/** A chat's record by its local view key, or undefined. */
export async function chatRecordById(tx: LocalFirstTransaction, deviceId: string, id: number): Promise<LocalRecord<ChatValue> | undefined> {
  return (await liveRecords<ChatValue>(tx, 'chat', deviceId, (row) => row.payload.chat.id === id))[0];
}

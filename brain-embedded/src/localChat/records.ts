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

import { selectRecords, type LocalFirstTransaction, type LocalRecord } from '@builderforce/local-first';
import type { BrainChat, BrainMessage } from '../types';

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

/** Whether a row is this device's own: written here, or this device's write pulled back. */
export function isOwnRecord(row: LocalRecord, deviceId: string): boolean {
  return row.provenance?.source !== 'imported' || row.provenance.deviceId === deviceId;
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

/** A chat's record by its local view key, or undefined. */
export async function chatRecordById(tx: LocalFirstTransaction, deviceId: string, id: number): Promise<LocalRecord<ChatValue> | undefined> {
  return (await liveRecords<ChatValue>(tx, 'chat', deviceId, (row) => row.payload.chat.id === id))[0];
}

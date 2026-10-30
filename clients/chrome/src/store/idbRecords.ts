/**
 * {@link RovrRecords} over IndexedDB — one database (`rovr`) for the extension origin,
 * read by the side panel and written by both it and the service worker.
 *
 * G26 — this adapter's durability, in one place. Two claims this store can actually
 * prove and nothing larger:
 *
 *  1. BUSY, NOT STOLEN. IndexedDB serialises writers itself, so this adapter adds no
 *     lock and therefore has no steal: nothing here admits a write because a lease
 *     looks old. The rule that would govern such a lease lives once, in
 *     `withWriteLease` (`records.ts`) — it polls while a holder exists and then
 *     refuses with {@link RovrLeaseBusyError}, and {@link rovrLockStolen} is false at
 *     any age — so the panel, the service worker and any later writer cannot each
 *     invent their own age-based override.
 *  2. NO QUIET EMPTY. Every read validates what the device returned
 *     ({@link readStoredChats}, {@link readStoredMessages}) and raises
 *     {@link RovrCorruptRecordError} rather than returning `[]`. `[]` is this store's
 *     truthful "nothing here"; handing it back for an unreadable store would make lost
 *     work look like a clean device.
 *
 * Both are the shared rules from `packages/local-first`, reached through `records.ts` —
 * this file states what it does with them, it does not redefine them.
 */
import { slotKeyedRows, type BrainMessage } from '@seanhogg/builderforce-brain-embedded';
import {
  newLocalChatId,
  readStoredChats,
  readStoredMessages,
  rovrLockStolen,
  RovrCorruptRecordError,
  RovrLeaseBusyError,
  type LedgerEntry,
  type LocalChat,
  type LocalTask,
  type MessageInput,
  type RovrRecords,
} from './records';
import { assembleAppend, publicMessage } from './storedMessage';

/** 2: the messages store gains the [chatId, eventKey] index, so a keyed append looks its key up instead of reading the chat. */
const VERSION = 2;
const CHATS = 'chats';
const MESSAGES = 'messages';
const TASKS = 'tasks';
const LEDGER = 'ledger';
const BY_CHAT = 'byChat';
const BY_CHAT_KEY = 'byChatKey';

type StoredMessage = Omit<BrainMessage, 'id' | 'seq'> & { id?: number; chatId: number; eventKey?: string };

function promised<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function createIdbRecords(factory: IDBFactory, dbName: string): RovrRecords {
  let db: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(dbName, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(CHATS)) d.createObjectStore(CHATS, { keyPath: 'id' });
        const messages = d.objectStoreNames.contains(MESSAGES)
          ? req.transaction!.objectStore(MESSAGES)
          : d.createObjectStore(MESSAGES, { keyPath: 'id', autoIncrement: true });
        if (!messages.indexNames.contains(BY_CHAT)) messages.createIndex(BY_CHAT, 'chatId');
        // Rows saved without a key have no entry in this index (an index skips a row whose key path is missing), and
        // rows written before version 2 are indexed by the upgrade itself - no migration of the data.
        if (!messages.indexNames.contains(BY_CHAT_KEY)) messages.createIndex(BY_CHAT_KEY, ['chatId', 'eventKey']);
        if (!d.objectStoreNames.contains(TASKS)) d.createObjectStore(TASKS, { keyPath: 'id' }).createIndex(BY_CHAT, 'chatId');
        if (!d.objectStoreNames.contains(LEDGER)) d.createObjectStore(LEDGER, { keyPath: 'id' }).createIndex(BY_CHAT, 'chatId');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((e: unknown) => {
      db = null;
      throw e;
    });
    return db;
  };

  const byChat = async <T>(store: string, chatId: number): Promise<T[]> => {
    const tx = (await open()).transaction(store, 'readonly');
    return promised(tx.objectStore(store).index(BY_CHAT).getAll(IDBKeyRange.only(chatId)) as IDBRequest<T[]>);
  };
  const put = async (store: string, value: unknown): Promise<void> => {
    const tx = (await open()).transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    await done(tx);
  };

  return {
    async listChats() {
      const tx = (await open()).transaction(CHATS, 'readonly');
      const all = await promised(tx.objectStore(CHATS).getAll() as IDBRequest<LocalChat[]>);
      // Validate before sorting: a malformed row must raise, never be sorted away.
      readStoredChats(all);
      return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async getChat(id) {
      const tx = (await open()).transaction(CHATS, 'readonly');
      const chat = await promised(tx.objectStore(CHATS).get(id) as IDBRequest<LocalChat | undefined>);
      // A row that is absent is the store's real answer; one that is present but
      // malformed is corruption, and must not read as "no such chat".
      if (chat !== undefined) readStoredChats([chat]);
      return chat;
    },
    async createChat(title) {
      const now = new Date().toISOString();
      const chat: LocalChat = { id: newLocalChatId(Date.now()), title, createdAt: now, updatedAt: now, syncKey: crypto.randomUUID() };
      const tx = (await open()).transaction(CHATS, 'readwrite');
      tx.objectStore(CHATS).add(chat);
      await done(tx);
      return chat;
    },
    async updateChat(id, patch) {
      const tx = (await open()).transaction(CHATS, 'readwrite');
      const store = tx.objectStore(CHATS);
      const current = await promised(store.get(id) as IDBRequest<LocalChat | undefined>);
      if (current) store.put({ ...current, ...patch, id });
      await done(tx);
    },
    async listMessages(chatId) {
      const rows = await byChat<StoredMessage & { id: number }>(MESSAGES, chatId);
      // Validate while `chatId` is still on the row, then strip it for the caller.
      // Dropping one bad row would silently shorten the only copy of the transcript.
      readStoredMessages(rows, chatId);
      return rows.sort((a, b) => a.id - b.id).map((m) => publicMessage({ ...m, seq: m.id }));
    },
    async appendMessages(chatId: number, rows: readonly MessageInput[]) {
      const createdAt = new Date().toISOString();
      const tx = (await open()).transaction([MESSAGES, CHATS], 'readwrite');
      const store = tx.objectStore(MESSAGES);
      // A row sent again under the key it was saved with is the same row: the saved one comes back (`slotKeyedRows`).
      // Looked up by key (`[chatId, eventKey]`), not by reading the chat: a long transcript costs the same as a short one.
      // A readwrite transaction on this store is serialised by IndexedDB itself, so two appends of one key cannot both miss it.
      const keys = [...new Set(rows.flatMap((row) => (row.eventKey ? [row.eventKey] : [])))];
      const found = await Promise.all(keys.map((key) => promised(store.index(BY_CHAT_KEY).get([chatId, key]) as IDBRequest<(StoredMessage & { id: number }) | undefined>)));
      const saved = new Map(found.flatMap((m, i) => (m ? [[keys[i]!, m] as const] : [])));
      const slots = slotKeyedRows(rows, (key) => saved.get(key));
      const inserts = slots.flatMap((slot) => (slot.kind === 'new' ? [slot] : []));
      const ids = await Promise.all(
        inserts.map(({ row, key }) => {
          const stored: StoredMessage = { chatId, role: row.role, content: row.content, metadata: row.metadata ?? null, createdAt, ...(key ? { eventKey: key } : {}) };
          return promised(store.add(stored) as IDBRequest<IDBValidKey>);
        }),
      );
      if (inserts.length > 0) {
        const chats = tx.objectStore(CHATS);
        const chat = await promised(chats.get(chatId) as IDBRequest<LocalChat | undefined>);
        if (chat) chats.put({ ...chat, updatedAt: createdAt });
      }
      await done(tx);
      let next = 0;
      return assembleAppend(
        slots,
        (m) => publicMessage({ ...m, seq: m.id, metadata: m.metadata ?? null }),
        (row) => {
          const id = Number(ids[next++]);
          return { id, seq: id, role: row.role, content: row.content, metadata: row.metadata ?? null, createdAt };
        },
      );
    },
    listTasks: (chatId) => byChat<LocalTask>(TASKS, chatId),
    async getTask(id) {
      const tx = (await open()).transaction(TASKS, 'readonly');
      return promised(tx.objectStore(TASKS).get(id) as IDBRequest<LocalTask | undefined>);
    },
    putTask: (task) => put(TASKS, task),
    async listLedger(chatId) {
      const rows = await byChat<LedgerEntry>(LEDGER, chatId);
      return rows.sort((a, b) => a.at.localeCompare(b.at));
    },
    addLedger: (entry) => put(LEDGER, entry),
  };
}

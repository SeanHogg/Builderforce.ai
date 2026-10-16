/**
 * {@link RovrRecords} over IndexedDB — one database (`rovr`) for the extension origin,
 * read by the side panel and written by both it and the service worker.
 */
import type { BrainMessage } from '@seanhogg/builderforce-brain-embedded';
import { newLocalChatId, type LedgerEntry, type LocalChat, type LocalTask, type MessageInput, type RovrRecords } from './records';

const VERSION = 1;
const CHATS = 'chats';
const MESSAGES = 'messages';
const TASKS = 'tasks';
const LEDGER = 'ledger';
const BY_CHAT = 'byChat';

type StoredMessage = Omit<BrainMessage, 'id' | 'seq'> & { id?: number; chatId: number };

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
        if (!d.objectStoreNames.contains(MESSAGES)) {
          d.createObjectStore(MESSAGES, { keyPath: 'id', autoIncrement: true }).createIndex(BY_CHAT, 'chatId');
        }
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
      return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async getChat(id) {
      const tx = (await open()).transaction(CHATS, 'readonly');
      return promised(tx.objectStore(CHATS).get(id) as IDBRequest<LocalChat | undefined>);
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
      return rows.sort((a, b) => a.id - b.id).map(({ chatId: _c, ...m }) => ({ ...m, seq: m.id }));
    },
    async appendMessages(chatId: number, rows: readonly MessageInput[]) {
      const createdAt = new Date().toISOString();
      const tx = (await open()).transaction([MESSAGES, CHATS], 'readwrite');
      const store = tx.objectStore(MESSAGES);
      const ids = await Promise.all(
        rows.map((row) => {
          const stored: StoredMessage = { chatId, role: row.role, content: row.content, metadata: row.metadata ?? null, createdAt };
          return promised(store.add(stored) as IDBRequest<IDBValidKey>);
        }),
      );
      const chats = tx.objectStore(CHATS);
      const chat = await promised(chats.get(chatId) as IDBRequest<LocalChat | undefined>);
      if (chat) chats.put({ ...chat, updatedAt: createdAt });
      await done(tx);
      return rows.map((row, i) => ({
        id: Number(ids[i]),
        seq: Number(ids[i]),
        role: row.role,
        content: row.content,
        metadata: row.metadata ?? null,
        createdAt,
      }));
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

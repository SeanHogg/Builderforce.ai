/**
 * The LOCAL-FIRST record — what Rovr knows on this device whether or not the platform
 * is reachable: its chats, their messages (conversation turns and the loop's step rows),
 * the tasks the chat produced, and the action ledger.
 *
 * Every write lands here FIRST and is then handed to the sync outbox (`sync/`), so a
 * chat started on a plane is complete on screen and reaches the platform when the
 * connection does. Chats get NEGATIVE local ids until the platform assigns one (the
 * mapping is kept on the chat as `serverId`), the convention the VS Code host already
 * uses for a run that is not yet a server chat.
 *
 * One port, two adapters: IndexedDB (`idbRecords.ts`, shared by the side panel and the
 * service worker — same extension origin, same database) and memory (tests).
 */
import type { BrainMessage } from '@seanhogg/builderforce-brain-embedded';

export interface LocalChat {
  /** Negative: local id. */
  id: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** The platform's chat id, once the sync outbox has created it. */
  serverId?: number;
  /** Minted with the chat — the `Idempotency-Key` its platform create is sent with, so a
   *  create whose answer was lost replays instead of making a second chat. */
  syncKey: string;
}

export type TaskSyncState = 'queued' | 'synced' | 'local';

export interface LocalTask {
  id: string;
  chatId: number;
  title: string;
  description: string;
  createdAt: string;
  state: TaskSyncState;
  /** The platform task id once created (also what makes a replay skip the create). */
  serverTaskId?: number;
}

export type LedgerOutcome = 'done' | 'failed' | 'declined';

/** One action Rovr took (or was refused) on a page. */
export interface LedgerEntry {
  id: string;
  chatId: number;
  at: string;
  tool: string;
  /** What it acted on — a short, human-readable target (button text, field label, URL). */
  target: string;
  tabId: number | null;
  url: string;
  outcome: LedgerOutcome;
  detail: string;
  /** A screenshot's data URL — kept on the device only, never in a synced step row. */
  image?: string;
}

export interface MessageInput {
  role: string;
  content: string;
  metadata?: string;
}

export interface RovrRecords {
  listChats(): Promise<LocalChat[]>;
  getChat(id: number): Promise<LocalChat | undefined>;
  createChat(title: string): Promise<LocalChat>;
  updateChat(id: number, patch: Partial<Omit<LocalChat, 'id'>>): Promise<void>;
  listMessages(chatId: number): Promise<BrainMessage[]>;
  appendMessages(chatId: number, rows: readonly MessageInput[]): Promise<BrainMessage[]>;
  listTasks(chatId: number): Promise<LocalTask[]>;
  getTask(id: string): Promise<LocalTask | undefined>;
  putTask(task: LocalTask): Promise<void>;
  listLedger(chatId: number): Promise<LedgerEntry[]>;
  addLedger(entry: LedgerEntry): Promise<void>;
}

export const newLocalChatId = (now: number, salt: number = Math.floor(Math.random() * 1000)): number =>
  -(Math.floor(now / 1000) * 1000 + salt);

/** In-memory {@link RovrRecords} — the tests' adapter. */
export function createMemoryRecords(): RovrRecords {
  const chats = new Map<number, LocalChat>();
  const messages: Array<BrainMessage & { chatId: number }> = [];
  const tasks = new Map<string, LocalTask>();
  const ledger: LedgerEntry[] = [];
  let seq = 0;
  return {
    async listChats() {
      return [...chats.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async getChat(id) {
      return chats.get(id);
    },
    async createChat(title) {
      const now = new Date().toISOString();
      let id = newLocalChatId(Date.now());
      while (chats.has(id)) id -= 1;
      const chat: LocalChat = { id, title, createdAt: now, updatedAt: now, syncKey: crypto.randomUUID() };
      chats.set(id, chat);
      return chat;
    },
    async updateChat(id, patch) {
      const chat = chats.get(id);
      if (chat) chats.set(id, { ...chat, ...patch });
    },
    async listMessages(chatId) {
      return messages.filter((m) => m.chatId === chatId).map(({ chatId: _c, ...m }) => m);
    },
    async appendMessages(chatId, rows) {
      const createdAt = new Date().toISOString();
      return rows.map((row) => {
        seq += 1;
        const msg = { id: seq, chatId, role: row.role, content: row.content, metadata: row.metadata ?? null, seq, createdAt };
        messages.push(msg);
        const { chatId: _c, ...out } = msg;
        return out;
      });
    },
    async listTasks(chatId) {
      return [...tasks.values()].filter((t) => t.chatId === chatId);
    },
    async getTask(id) {
      return tasks.get(id);
    },
    async putTask(task) {
      tasks.set(task.id, task);
    },
    async listLedger(chatId) {
      return ledger.filter((e) => e.chatId === chatId);
    },
    async addLedger(entry) {
      ledger.push(entry);
    },
  };
}

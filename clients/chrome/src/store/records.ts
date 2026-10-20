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
 *
 * G26 — durability is NOT equivalent across adapters, so this store says what it does
 * guarantee, in this file, once (see the `ROVR_*` section at the end): a write lease
 * that is WAITED OUT and never taken by age, a corrupt device read that fails loudly
 * instead of coming back empty, and one stated redaction rule for the only shape of a
 * record that may be uploaded or logged. The rules themselves are not restated here —
 * they come from `packages/local-first`, the contract both hosts share.
 */
import type { BrainMessage, ChatMode, Effort } from '@seanhogg/builderforce-brain-embedded';
// G26: the durability rules are NOT restated here. `durabilityContract` has no
// subpath export and is not re-exported from the package entry (owned elsewhere),
// so it is imported by path — the same way `clients/vscode/src/localFirstStore.ts`
// reaches it — rather than by duplicating its logic into a second policy.
import {
  BUSY_TIMEOUT,
  lockStolen,
  leaseBusy,
  recoverSnapshot,
  requiresRecoveryCopy,
} from '../../../../packages/local-first/src/durabilityContract';
import {
  DEFAULT_BUSY_POLL_MS,
  DEFAULT_BUSY_TIMEOUT_MS,
  INDEXEDDB_REDACTED_KEYS,
  INDEXEDDB_REDACTION_RULE,
  redactSnapshotForUploadOrLog,
} from '../../../../packages/local-first/src/indexedDb';

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
  /** The composer's `/` Work panel, kept per chat on the device (absent ⇒ the default):
   *  Chat | Work (default chat — a personal assistant answers, it does not open board
   *  work), the Effort level and Thinking toggle that shape the request, and the Memory
   *  switch (default on; mirrored to the platform chat once it exists). */
  mode?: ChatMode;
  effort?: Effort;
  thinking?: boolean;
  memoryEnabled?: boolean;
  /** Archive flag, mirroring the platform chat's `is_archived` — a chat the device
   *  knows is archived is offered no Archive action by the history row menu (there is
   *  nothing left to archive). Absent ⇒ not archived, the same convention as the
   *  platform's column default and as `BrainChat.isArchived`. */
  isArchived?: boolean;
  /** The user's FIRST prompt for this chat, kept verbatim on the device and sent with
   *  the platform create (migration 1245). The title is only a ~60-char derivation of
   *  it, so a chat synced from here would otherwise lose what it was actually asked.
   *  Absent ⇒ nothing captured (a chat created before the seam, or an empty first turn). */
  originalRequest?: string;
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
  /**
   * The project this task is filed under, pinned the first time sync sees it so a later
   * project switch cannot move it. `undefined` = not pinned yet; `null` = pinned unbound
   * (no project: the task stays local and is never sent).
   */
  projectId?: number | null;
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

/* ------------------------------------------------------------------------- *
 * G26 — what this adapter guarantees, stated once and reused, not re-derived.
 *
 * These three bindings are the ONLY place the Rovr store names its durability
 * behaviour. They are re-exports, not copies: the classification (a lease is busy
 * until its holder releases, a snapshot is corrupt or it is not, which keys are
 * secrets) lives in `packages/local-first`, which the VSIX file host also uses, so
 * there is exactly one rule and this host cannot drift into a second one.
 * ------------------------------------------------------------------------- */

/**
 * Rovr's busy timeout. `'until_release'` is a WAIT, not a window: a second context
 * that finds the write lease held is refused with {@link RovrLeaseBusyError} once
 * the shared poll deadline passes — it is never admitted because the lease looks
 * old. See `idbRecords.ts` for where the lease is taken.
 */
export const ROVR_BUSY_TIMEOUT = BUSY_TIMEOUT;

/** How long Rovr waits for a held lease before refusing, per poll. */
export const ROVR_BUSY_TIMEOUT_MS = DEFAULT_BUSY_TIMEOUT_MS;

/** Gap between lease attempts while another context holds the lease. */
export const ROVR_BUSY_POLL_MS = DEFAULT_BUSY_POLL_MS;

/**
 * Age does not take a foreign lease. Held true at any age, including long past any
 * plausible steal window — the holder must release it.
 */
export function rovrLeaseBusy(holder: string | null | undefined, now?: number, heldSince?: number): boolean {
  return leaseBusy(holder, now, heldSince);
}

/**
 * Always false. This adapter has no steal path at any age, so a crashed context
 * blocks writes until its lease is cleared rather than letting a second context
 * write on top of it.
 */
export function rovrLockStolen(
  holder: string | null | undefined,
  now?: number,
  heldSince?: number,
  stealAfterMs?: number,
): boolean {
  return lockStolen(holder, now, heldSince, stealAfterMs);
}

/** Thrown when a write lease is still held after {@link ROVR_BUSY_TIMEOUT_MS}. */
export class RovrLeaseBusyError extends Error {
  constructor(holder: string) {
    super(`rovr_record_store_busy: lease held by ${holder}`);
    this.name = 'RovrLeaseBusyError';
  }
}

/** The lease row Rovr keeps beside the database, in the `rovr` database itself. */
export interface RovrWriteLease {
  /** The context that holds it. Empty/absent means nobody does. */
  holder: string;
  /** When it was taken. Age is recorded but never acted on. */
  heldSince: number;
}

/**
 * Run `write` only if the write lease is free, or wait for it — then refuse.
 *
 * The single place Rovr takes a lease, so the rule cannot be restated per caller:
 * while `read()` reports a holder, wait {@link ROVR_BUSY_POLL_MS} and re-read until
 * {@link ROVR_BUSY_TIMEOUT_MS} has elapsed, then throw {@link RovrLeaseBusyError}. There
 * is deliberately no branch on the lease's age: `rovrLeaseBusy(holder, idle, heldSince)`
 * stays true at 30s and at an hour, and `rovrLockStolen` is false at every age, so a
 * lease older than any window is still BUSY. A crashed context therefore blocks writes
 * until its lease is released or explicitly cleared, rather than a second context
 * interleaving into the same database.
 */
export async function withWriteLease<T>(
  read: () => RovrWriteLease | undefined | Promise<RovrWriteLease | undefined>,
  write: () => Promise<T>,
  now: () => number = Date.now,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  const deadline = now() + ROVR_BUSY_TIMEOUT_MS;
  for (;;) {
    const lease = await read();
    // A holder with an empty id is not a holder — there is no lease to take or wait on.
    if (!rovrLeaseBusy(lease?.holder, now(), lease?.heldSince)) return await write();
    if (now() >= deadline) throw new RovrLeaseBusyError(lease?.holder ?? '');
    await wait(ROVR_BUSY_POLL_MS);
  }
}

/**
 * A record that came back from the device but is not the shape this store writes.
 *
 * IndexedDB itself will not hand back a half-written row, so this is the OTHER
 * corruption — a row that parses and yet is not a record (a stray key, a truncated
 * write, a store written by a different build). It must NOT be reported as `[]`:
 * an empty list is a truthful "there is nothing here", and returning that for an
 * unreadable store makes lost work look like a clean device.
 */
export class RovrCorruptRecordError extends Error {
  constructor(detail: string) {
    super(`rovr_record_store_corrupt: ${detail}`);
    this.name = 'RovrCorruptRecordError';
  }
}

/** The minimum a stored chat must carry for the panel to render it. */
function assertChat(value: unknown): asserts value is LocalChat {
  if (value === null || typeof value !== 'object') throw new RovrCorruptRecordError('chat row is not an object');
  const chat = value as Partial<LocalChat>;
  if (typeof chat.id !== 'number') throw new RovrCorruptRecordError('chat row has no numeric id');
  if (typeof chat.title !== 'string') throw new RovrCorruptRecordError(`chat ${chat.id} has no title`);
  if (typeof chat.updatedAt !== 'string') throw new RovrCorruptRecordError(`chat ${chat.id} has no updatedAt`);
  if (typeof chat.syncKey !== 'string' || chat.syncKey.length === 0) {
    throw new RovrCorruptRecordError(`chat ${chat.id} has no syncKey`);
  }
}

/**
 * Validate what the device returned, or throw — never coerce to empty.
 *
 * `[]` and `undefined` are the store's real answers for "nothing here", so they
 * pass through untouched; anything present but malformed is corruption and is
 * raised rather than dropped. This is the difference between a store that loses
 * work quietly and one that says so.
 */
export function readStoredChats(rows: readonly unknown[]): LocalChat[] {
  for (const row of rows) assertChat(row);
  return rows as LocalChat[];
}

/** The minimum a stored message must carry for the transcript to render it. */
function assertMessage(value: unknown, chatId: number): void {
  if (value === null || typeof value !== 'object') {
    throw new RovrCorruptRecordError(`message row for chat ${chatId} is not an object`);
  }
  const row = value as Partial<BrainMessage> & { chatId?: number };
  if (typeof row.chatId !== 'number') throw new RovrCorruptRecordError('message row has no chatId');
  if (typeof row.id !== 'number') throw new RovrCorruptRecordError(`message row for chat ${chatId} has no id`);
  if (typeof row.role !== 'string' || row.role.length === 0) {
    throw new RovrCorruptRecordError(`message ${row.id} has no role`);
  }
  if (typeof row.content !== 'string') throw new RovrCorruptRecordError(`message ${row.id} has no content`);
}

/**
 * The same contract as {@link readStoredChats}, for one chat's transcript: a
 * malformed row is raised, never skipped — skipping it would silently shorten a
 * transcript that is the only copy of the user's work.
 */
export function readStoredMessages(rows: readonly unknown[], chatId: number): BrainMessage[] {
  for (const row of rows) assertMessage(row, chatId);
  return rows as BrainMessage[];
}

/**
 * THE redaction rule for this store, in words. A secret-shaped key is stripped
 * before a record is uploaded or logged; `export()`-equivalent local reads keep
 * everything, because they never leave the device.
 */
export const ROVR_REDACTION_RULE = INDEXEDDB_REDACTION_RULE;

/** The keys {@link rovrRedactForUploadOrLog} drops. */
export const ROVR_REDACTED_KEYS = INDEXEDDB_REDACTED_KEYS;

/**
 * The only shape of a Rovr record eligible to leave the device or reach a log:
 * every secret-shaped key stripped at every depth, input not mutated, dropped keys
 * absent rather than blanked.
 */
export function rovrRedactForUploadOrLog<T>(value: T): T {
  return redactSnapshotForUploadOrLog(value);
}

/**
 * Parse a snapshot without throwing, for the same reason as
 * {@link readStoredChats}: a corrupt read is a failure, not an empty store.
 * IndexedDB needs no recovery file beside it — `requiresRecoveryCopy('indexeddb')`
 * is false — but a caller that serialises this store still gets the classification.
 */
export const rovrRecoverSnapshot = recoverSnapshot;

/** False: an IndexedDB transaction is the durability, there is no second file. */
export const ROVR_REQUIRES_RECOVERY_COPY = requiresRecoveryCopy('indexeddb');

/** In-memory {@link RovrRecords} — the tests' adapter. */
export function createMemoryRecords(): RovrRecords {
  const chats = new Map<number, LocalChat>();
  const messages: Array<BrainMessage & { chatId: number }> = [];
  const tasks = new Map<string, LocalTask>();
  const ledger: LedgerEntry[] = [];
  let seq = 0;
  return {
    async listChats() {
      const live = [...chats.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      // Same guarantee as the IndexedDB adapter: a malformed in-memory row is raised,
      // never skipped out of the list.
      return readStoredChats(live);
    },
    async getChat(id) {
      const chat = chats.get(id);
      if (chat !== undefined) readStoredChats([chat]);
      return chat;
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
      // Validate while `chatId` is still on the row, then strip it for the caller.
      const own = messages.filter((m) => m.chatId === chatId);
      readStoredMessages(own, chatId);
      return own.map(({ chatId: _c, ...m }) => m);
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

/**
 * The chats a surface may LIST: everything not archived. Archive writes `isArchived`
 * onto the local record and never deletes it (an unsynced transcript must survive),
 * and the device store has no `archived=exclude` query like the platform list — so
 * every chat list filters through here. Returns a new array; the input is untouched.
 */
export function liveChats(chats: readonly LocalChat[]): LocalChat[] {
  return chats.filter((chat) => chat.isArchived !== true);
}

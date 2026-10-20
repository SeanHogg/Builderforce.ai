import * as vscode from "vscode";
import nodeFs from "node:fs";
import nodePath from "node:path";
import type { BrainChat, BrainMessage } from "@seanhogg/builderforce-brain-embedded";
import {
  INDEXEDDB_REDACTION_RULE,
  createMemoryLocalFirstStore,
  leaseBusy,
  newLocalRecord,
  redactSnapshotForUploadOrLog,
  type JournalOperation,
  type LocalFirstSnapshot,
  type LocalFirstStore,
  type LocalFirstTransaction,
  type LocalRecord,
} from "@builderforce/local-first";

const fs = nodeFs.promises;

function validSnapshot(value: unknown): value is LocalFirstSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<LocalFirstSnapshot>;
  return Array.isArray(snapshot.records)
    && Array.isArray(snapshot.events)
    && Array.isArray(snapshot.mappings)
    && Array.isArray(snapshot.receipts)
    && Array.isArray(snapshot.conflicts)
    && typeof snapshot.cursors === "object"
    && typeof snapshot.nextSequence === "number";
}

/** Stable name for a snapshot file that exists but cannot be trusted. */
export const LOCAL_FIRST_SNAPSHOT_CORRUPT = "local_first_snapshot_corrupt";

/** Thrown after the bad file has been copied aside. `message` includes `recoveryPath`. */
export class LocalFirstSnapshotCorruptError extends Error {
  readonly recoveryPath: string;
  constructor(recoveryPath: string) {
    super(`${LOCAL_FIRST_SNAPSHOT_CORRUPT}: ${recoveryPath}`);
    this.name = LOCAL_FIRST_SNAPSHOT_CORRUPT;
    this.recoveryPath = recoveryPath;
  }
}

/** `…/local-first-v1.json` → `…/local-first-v1.json.corrupt-<timestamp>`. */
export function corruptSnapshotRecoveryPath(snapshotPath: string, timestamp: number): string {
  return `${snapshotPath}.corrupt-${timestamp}`;
}

export type SnapshotLoadPlan =
  | { action: "use"; snapshot: LocalFirstSnapshot }
  | { action: "preserve"; recoveryPath: string; error: LocalFirstSnapshotCorruptError };

/**
 * Classify the text of a snapshot file that already exists.
 * Invalid JSON, or a shape `validSnapshot` rejects, is `preserve`: the caller
 * keeps the bytes at `recoveryPath` (the store moves the cache aside and opens
 * from the journal; `loadExistingSnapshot` copies it and throws). Classification
 * does not invent an empty snapshot from the bad bytes.
 */
export function planSnapshotLoad(text: string, snapshotPath: string, timestamp: number): SnapshotLoadPlan {
  const recoveryPath = corruptSnapshotRecoveryPath(snapshotPath, timestamp);
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return { action: "preserve", recoveryPath, error: new LocalFirstSnapshotCorruptError(recoveryPath) };
  }
  if (!validSnapshot(value)) {
    return { action: "preserve", recoveryPath, error: new LocalFirstSnapshotCorruptError(recoveryPath) };
  }
  return { action: "use", snapshot: value };
}

/**
 * Load a present snapshot. On parse or shape failure, copy the original file to
 * `local-first-v1.json.corrupt-<timestamp>` and throw. A corrupt file is not
 * opened as an empty store, and the original is left in place so the next open
 * fails closed instead of succeeding with nothing.
 */
export async function loadExistingSnapshot(
  text: string,
  snapshotPath: string,
  timestamp: number,
  copyCorruptFile: (from: string, to: string) => Promise<void>,
): Promise<LocalFirstSnapshot> {
  const plan = planSnapshotLoad(text, snapshotPath, timestamp);
  if (plan.action === "preserve") {
    await copyCorruptFile(snapshotPath, plan.recoveryPath);
    throw plan.error;
  }
  return structuredClone(plan.snapshot);
}

const SNAPSHOT_FILE = "local-first-v1.json";
const JOURNAL_FILE = "local-first-v2.journal";
const LOCK_FILE = "local-first-v1.lock";
/**
 * How long a second owner polls before `local_first_store_busy`.
 * Not a steal window: a lock older than 30s is still the holder's.
 */
export const LOCAL_FIRST_BUSY_TIMEOUT_MS = 1_500;
/** Pause between exclusive `wx` attempts while another owner holds the lock. */
export const LOCAL_FIRST_BUSY_POLL_MS = 25;
/** Same bytes as `JOURNAL_FRAME_MAGIC` in `@builderforce/local-first` (`BFJF1` + u32 length + u32 crc). */
const FRAME_MAGIC = "BFJF1";
const FRAME_HEADER_BYTES = FRAME_MAGIC.length + 8;

/** Journal-backed store. `local-first-v1.json` is a republished cache, not the commit. */
export interface DurableLocalFirstStore extends LocalFirstStore {
  flush(): Promise<void>;
  readonly snapshotFile: string;
  readonly journalFile: string;
  /**
   * Only snapshot eligible to be uploaded or logged.
   * Rule: `VSIX_LOCAL_FIRST_REDACTION_RULE`, which is `INDEXEDDB_REDACTION_RULE`.
   */
  exportForUploadOrLog(): Promise<LocalFirstSnapshot>;
}

/**
 * Stated redaction rule for this surface. Identical to the IndexedDB adapter:
 * only `exportForUploadOrLog()` may leave the device. Not a second policy.
 */
export const VSIX_LOCAL_FIRST_REDACTION_RULE = INDEXEDDB_REDACTION_RULE;

function snapshotHasState(snapshot: LocalFirstSnapshot): boolean {
  return snapshot.records.length > 0
    || snapshot.events.length > 0
    || snapshot.mappings.length > 0
    || snapshot.receipts.length > 0
    || snapshot.conflicts.length > 0
    || Object.keys(snapshot.cursors).length > 0
    || snapshot.nextSequence !== 1;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc ^= bytes[index];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function isDurableSnapshot(value: unknown): value is LocalFirstSnapshot {
  return validSnapshot(value) && value.cursors != null;
}

/** One committed transaction. Same `BFJF1` frame a restart of this file opens. */
function encodeDurableJournalFrame(snapshot: LocalFirstSnapshot): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(snapshot));
  const frame = new Uint8Array(FRAME_HEADER_BYTES + body.length);
  for (let index = 0; index < FRAME_MAGIC.length; index += 1) frame[index] = FRAME_MAGIC.charCodeAt(index);
  const view = new DataView(frame.buffer);
  view.setUint32(FRAME_MAGIC.length, body.length, false);
  view.setUint32(FRAME_MAGIC.length + 4, crc32(body), false);
  frame.set(body, FRAME_HEADER_BYTES);
  return frame;
}

/** Complete frames only. A torn or bad tail is not a commit. */
export function decodeDurableJournalFrames(bytes: Uint8Array): LocalFirstSnapshot[] {
  const frames: LocalFirstSnapshot[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (offset + FRAME_HEADER_BYTES <= bytes.byteLength) {
    for (let index = 0; index < FRAME_MAGIC.length; index += 1) {
      if (bytes[offset + index] !== FRAME_MAGIC.charCodeAt(index)) return frames;
    }
    const length = view.getUint32(offset + FRAME_MAGIC.length, false);
    const expected = view.getUint32(offset + FRAME_MAGIC.length + 4, false);
    const end = offset + FRAME_HEADER_BYTES + length;
    if (end > bytes.byteLength) return frames;
    const body = bytes.subarray(offset + FRAME_HEADER_BYTES, end);
    if (crc32(body) !== expected) return frames;
    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
      if (!isDurableSnapshot(parsed)) return frames;
      frames.push(parsed);
    } catch {
      return frames;
    }
    offset = end;
  }
  return frames;
}

/** Byte length of the leading complete frames. A torn tail is excluded. */
function completePrefixLength(bytes: Uint8Array): number {
  const frames = decodeDurableJournalFrames(bytes);
  if (frames.length === 0) return 0;
  let offset = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let count = 0; count < frames.length; count += 1) {
    const length = view.getUint32(offset + FRAME_MAGIC.length, false);
    offset += FRAME_HEADER_BYTES + length;
  }
  return offset;
}

function createNodeJournalIo(directory: string) {
  const journalFile = nodePath.join(directory, JOURNAL_FILE);

  const readBytes = async (): Promise<Uint8Array | undefined> => {
    try {
      const raw = await fs.readFile(journalFile);
      const copy = new Uint8Array(raw.byteLength);
      copy.set(raw);
      return copy;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  };

  const syncFile = async (path: string): Promise<void> => {
    const handle = await fs.open(path, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  };

  const atomicReplace = async (bytes: Uint8Array): Promise<void> => {
    const temporary = `${journalFile}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(temporary, bytes);
      await syncFile(temporary);
      await fs.rename(temporary, journalFile);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
  };

  return {
    async read() {
      return readBytes();
    },
    async append(frame: Uint8Array) {
      await fs.mkdir(directory, { recursive: true });
      const existing = await readBytes();
      if (existing && completePrefixLength(existing) !== existing.byteLength) {
        const kept = existing.subarray(0, completePrefixLength(existing));
        const merged = new Uint8Array(kept.byteLength + frame.byteLength);
        merged.set(kept, 0);
        merged.set(frame, kept.byteLength);
        await atomicReplace(merged);
        return;
      }
      // The frame is durable only after fsync. Callers are not told the write
      // was saved until this returns.
      await fs.appendFile(journalFile, frame);
      await syncFile(journalFile);
    },
    async replace(frame: Uint8Array) {
      await fs.mkdir(directory, { recursive: true });
      await atomicReplace(frame);
    },
    async size() {
      try {
        return (await fs.stat(journalFile)).size;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
        throw error;
      }
    },
  };
}

/**
 * Commit boundary for writes this file owns.
 *
 * A transaction is one journal frame (every record and sync event the callback
 * put/appended) fsynced to `local-first-v2.journal` before the promise resolves.
 * `local-first-v1.json` is republished afterwards as a cache. Deleting it does
 * not drop committed rows. A corrupt cache is ignored when a journal frame
 * exists. With no journal, the corrupt file is copied aside and the open
 * throws — it is never replaced with an empty store.
 *
 * Project, ticket, audit, and run rows are not written here.
 */
interface LockLease {
  holder: string | null;
  heldSince?: number;
}

async function readLockLease(lockPath: string): Promise<LockLease> {
  try {
    const parsed = JSON.parse(await fs.readFile(lockPath, "utf8")) as { holder?: unknown; heldSince?: unknown };
    return {
      holder: typeof parsed?.holder === "string" && parsed.holder.length > 0 ? parsed.holder : null,
      ...(typeof parsed?.heldSince === "number" ? { heldSince: parsed.heldSince } : {}),
    };
  } catch {
    return { holder: null };
  }
}

export function createVsCodeLocalFirstStore(
  ctx: vscode.ExtensionContext,
  beforeWrite: Promise<void> = Promise.resolve(),
): DurableLocalFirstStore {
  const directory = ctx.globalStorageUri.fsPath;
  const snapshotFile = nodePath.join(directory, SNAPSHOT_FILE);
  const journalFile = nodePath.join(directory, JOURNAL_FILE);
  const lock = nodePath.join(directory, LOCK_FILE);
  const io = createNodeJournalIo(directory);
  const listeners = new Set<() => void>();
  let memory = createMemoryLocalFirstStore();
  let durable: LocalFirstSnapshot | undefined;
  let opened: Promise<void> | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  let republished: Promise<void> = Promise.resolve();

  const readLegacySnapshot = async (): Promise<LocalFirstSnapshot | undefined> => {
    let text: string;
    try {
      text = await fs.readFile(snapshotFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    // The snapshot is a derived cache / one-way legacy import, not the record (the
    // journal is). A corrupt copy is MOVED aside — kept whole, exportable — and the
    // open continues from the journal. Throwing here would fail every later open too,
    // locking the person out of their local store over a cache file.
    const plan = planSnapshotLoad(text, snapshotFile, Date.now());
    if (plan.action === "preserve") {
      await fs.rename(snapshotFile, plan.recoveryPath);
      return undefined;
    }
    return plan.snapshot;
  };

  const ensureOpen = (): Promise<void> => {
    opened ??= (async () => {
      const bytes = await io.read();
      const frames = bytes && bytes.byteLength > 0 ? decodeDurableJournalFrames(bytes) : [];
      const legacy = frames.length > 0 ? frames[frames.length - 1] : await readLegacySnapshot();
      if (frames.length === 0 && legacy && snapshotHasState(legacy)) {
        await io.append(encodeDurableJournalFrame(legacy));
      }
      durable = legacy && (frames.length > 0 || snapshotHasState(legacy)) ? legacy : undefined;
      memory = createMemoryLocalFirstStore(durable);
    })().catch((error: unknown) => {
      opened = undefined;
      throw error;
    });
    return opened;
  };

  const ownerId = crypto.randomUUID();
  /**
   * Exclusive `wx` create. The lock file names the holder. On EEXIST, `leaseBusy`
   * decides: a named holder stays busy no matter how old the file is, and a lock
   * we cannot name is not deleted. After the busy timeout, throw
   * `local_first_store_busy`. Only the holder releases the file.
   */
  const acquire = async (): Promise<void> => {
    await fs.mkdir(directory, { recursive: true });
    const deadline = Date.now() + LOCAL_FIRST_BUSY_TIMEOUT_MS;
    for (;;) {
      try {
        const handle = await fs.open(lock, "wx");
        try {
          await handle.writeFile(JSON.stringify({ holder: ownerId, heldSince: Date.now() }));
        } finally {
          await handle.close();
        }
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const now = Date.now();
        const lease = await readLockLease(lock);
        // Age is an argument to leaseBusy and is ignored. Do not unlink.
        if (leaseBusy(lease.holder, now, lease.heldSince) || lease.holder === null) {
          if (now >= deadline) throw new Error("local_first_store_busy");
          await new Promise((resolve) => setTimeout(resolve, LOCAL_FIRST_BUSY_POLL_MS));
          continue;
        }
        if (now >= deadline) throw new Error("local_first_store_busy");
        await new Promise((resolve) => setTimeout(resolve, LOCAL_FIRST_BUSY_POLL_MS));
      }
    }
  };

  const republish = async (): Promise<void> => {
    const snapshot = await memory.export();
    const temporary = `${snapshotFile}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(temporary, JSON.stringify(snapshot), { encoding: "utf8", flag: "wx" });
      await fs.rename(temporary, snapshotFile);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
  };

  return {
    snapshotFile,
    journalFile,
    async read(work) {
      await ensureOpen();
      return memory.read(work);
    },
    transact(work) {
      const run = tail.then(async () => {
        let held = false;
        try {
          await acquire();
          held = true;
          await ensureOpen();
          await beforeWrite;
          let result: Awaited<ReturnType<typeof work>>;
          let next: LocalFirstSnapshot;
          try {
            result = await memory.transact(work);
            next = await memory.export();
          } catch (error) {
            memory = createMemoryLocalFirstStore(durable);
            throw error;
          }
          try {
            await io.append(encodeDurableJournalFrame(next));
          } catch (error) {
            memory = createMemoryLocalFirstStore(durable);
            throw error;
          }
          durable = next;
          for (const listener of [...listeners]) listener();
          const pending = republished.catch(() => undefined).then(() => republish());
          republished = pending;
          void pending.catch(() => undefined);
          return result;
        } finally {
          if (held) await fs.rm(lock, { force: true });
        }
      });
      tail = run.then(() => undefined, () => undefined);
      return run;
    },
    async export() {
      await ensureOpen();
      return memory.export();
    },
    /** Upload/log boundary. The rule is VSIX_LOCAL_FIRST_REDACTION_RULE. */
    async exportForUploadOrLog() {
      return redactSnapshotForUploadOrLog(await this.export());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async flush() {
      await tail;
      await republished;
    },
  };
}

interface ChatPayload {
  clientId: string;
  chat: BrainChat;
}

interface MessagePayload {
  clientId: string;
  chatId: number;
  chatClientId: string;
  eventKey: string;
  message: BrainMessage;
}

/**
 * Chat and message writes for origin callers (`auditExecution`, `brainRunHostPorts`).
 * Writes go through the durable store, so an acknowledged chat is a journal frame.
 * This is not the full Brain adapter: list/update/delete/archive/summarize/upload
 * stay on the server adapter. Those methods are not called on this object.
 */
function createHostPersistence(store: LocalFirstStore, deviceId: string) {
  const stamp = () => new Date().toISOString();
  const live = async <T>(tx: LocalFirstTransaction, type: "chat" | "message") =>
    (await tx.list<T>(type)).filter((row) => !row.deletedAt);
  const append = async <T>(
    tx: LocalFirstTransaction,
    record: LocalRecord<T>,
    operation: JournalOperation,
    eventId: string,
    dependsOn: string[] = [],
  ) => {
    await tx.append({
      eventId,
      clientEntityId: record.id,
      entityType: record.entityType,
      operation,
      schemaVersion: record.schemaVersion,
      occurredAt: record.occurredAt,
      ...(record.baseVersion !== undefined ? { baseVersion: record.baseVersion } : {}),
      dependsOn,
      destination: record.destination,
      payload: record.payload,
    });
  };
  const nextNumericId = (chats: LocalRecord<ChatPayload>[], messages: LocalRecord<MessagePayload>[]) =>
    Math.max(
      0,
      ...chats.map((row) => row.payload.chat.id),
      ...messages.map((row) => row.payload.message.id),
    ) + 1;
  return {
    async createChat(body: {
      title?: string;
      originalRequest?: string | null;
      projectId?: number | null;
      capability?: string | null;
      mode?: string | null;
    }): Promise<BrainChat> {
      return store.transact(async (tx) => {
        const chats = await live<ChatPayload>(tx, "chat");
        const messages = await live<MessagePayload>(tx, "message");
        const at = stamp();
        const clientId = crypto.randomUUID();
        const chat: BrainChat = {
          id: nextNumericId(chats, messages),
          title: body.title ?? "New chat",
          projectId: body.projectId ?? null,
          origin: "local",
          capability: body.capability ?? null,
          mode: body.mode ?? null,
          originalRequest: body.originalRequest ?? null,
          createdAt: at,
          updatedAt: at,
        };
        const record = newLocalRecord<ChatPayload>({
          id: clientId,
          entityType: "chat",
          payload: { clientId, chat },
          deviceId,
          occurredAt: at,
        });
        await tx.put(record);
        await append(tx, record, "create", `chat:${clientId}`);
        return chat;
      });
    },
    async getChat(id: number): Promise<BrainChat | undefined> {
      return store.read(async (tx) => {
        const row = (await live<ChatPayload>(tx, "chat")).find((candidate) => candidate.payload.chat.id === id);
        return row?.payload.chat;
      });
    },
    async getMessages(chatId: number): Promise<BrainMessage[]> {
      return store.read(async (tx) =>
        (await live<MessagePayload>(tx, "message"))
          .filter((row) => row.payload.chatId === chatId)
          .sort((a, b) => a.payload.message.seq - b.payload.message.seq)
          .map((row) => row.payload.message),
      );
    },
    async sendMessages(
      chatId: number,
      input: Array<{ role: string; content: string; metadata?: string }>,
    ): Promise<BrainMessage[]> {
      return store.transact(async (tx) => {
        const chats = await live<ChatPayload>(tx, "chat");
        const messages = await live<MessagePayload>(tx, "message");
        const chat = chats.find((row) => row.payload.chat.id === chatId);
        if (!chat) throw new Error(`No such local chat: ${chatId}`);
        const existing = messages.filter((row) => row.payload.chatId === chatId);
        const firstId = nextNumericId(chats, messages);
        const at = stamp();
        const added = input.map((message, index): BrainMessage => ({
          id: firstId + index,
          role: message.role,
          content: message.content,
          metadata: message.metadata ?? null,
          seq: existing.length + index + 1,
          createdAt: at,
        }));
        for (const message of added) {
          const clientId = crypto.randomUUID();
          const eventKey = `message:${clientId}`;
          const record = newLocalRecord<MessagePayload>({
            id: clientId,
            entityType: "message",
            payload: { clientId, chatId, chatClientId: chat.id, eventKey, message },
            deviceId,
            destination: chat.destination,
            occurredAt: at,
          });
          await tx.put(record);
          await append(tx, record, "create", eventKey, [`chat:${chat.id}`]);
        }
        return added;
      });
    },
  };
}

interface LocalApplication {
  store: LocalFirstStore;
  /** G03: the journal-backed store. The JSON snapshot is its cache, not its state. */
  durableStore: DurableLocalFirstStore;
  persistence: ReturnType<typeof createHostPersistence>;
}

const applications = new WeakMap<vscode.ExtensionContext, LocalApplication>();

export function localBrainApplication(ctx: vscode.ExtensionContext): LocalApplication {
  const existing = applications.get(ctx);
  if (existing) return existing;
  const deviceKey = "builderforce.localDeviceId";
  const storedDeviceId = ctx.globalState.get<string>(deviceKey);
  // G04: the id must be durable before any write stamps it. A crash between
  // minting and globalState.update used to mint a second device id on restart.
  const deviceId = storedDeviceId && storedDeviceId.length > 0 ? storedDeviceId : crypto.randomUUID();
  const devicePersisted = deviceId === storedDeviceId
    ? Promise.resolve()
    : Promise.resolve(ctx.globalState.update(deviceKey, deviceId)).then(() => undefined);
  // G03: one journal frame per committed transaction. The promise resolves
  // only after that frame is fsynced. `local-first-v1.json` is a cache.
  const store = createVsCodeLocalFirstStore(ctx, devicePersisted);
  const application = {
    store,
    durableStore: store,
    persistence: createHostPersistence(store, deviceId),
  };
  applications.set(ctx, application);
  return application;
}

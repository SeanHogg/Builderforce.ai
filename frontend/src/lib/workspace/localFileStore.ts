/**
 * A workspace held in THIS browser — what the canvas App surface runs for a person who has
 * not signed up yet.
 *
 * Same port as the durable store (`workspaceFileStore.ts`), so the editor, the run pipeline
 * and the Brain's build tools are unchanged; only where a write lands differs. "Keep your
 * work" turns the board into a durable session, and the App surface then provisions a real
 * project and uploads these files into it (`useCanvasSessionApp`).
 *
 * ── STORAGE ──────────────────────────────────────────────────────────────────────
 * IndexedDB, one record per workspace (`{ key, files }`): an app is tens of small text
 * files, so whole-record writes are simpler than a row per file and cost nothing. Reads
 * are served from an in-memory copy loaded once per key. Where IndexedDB is unavailable
 * (private mode in some browsers, tests) the in-memory copy is the store for the life of
 * the tab — the app still runs; it just does not survive a reload, which is the same
 * promise an account-less board makes.
 */
import { searchEntries, type WorkspaceFileStore } from './workspaceFileStore';
import type { LocalWorkspaceId } from './workspaceId';
import type { FileEntry } from '@/lib/types';

const DB_NAME = 'builderforce-local-workspaces';
const DB_VERSION = 1;
const STORE = 'workspaces';

interface LocalWorkspaceRecord {
  key: string;
  files: Record<string, string>;
}

/** The in-memory copy, per workspace key. The source of truth while the tab lives. */
const memory = new Map<string, Map<string, string>>();
/** One load per key, however many readers ask first. */
const loading = new Map<string, Promise<Map<string, string>>>();

export function localWorkspaceId(key: string): LocalWorkspaceId {
  return `local:${key}`;
}

function openDb(): Promise<IDBDatabase> | null {
  if (typeof indexedDB === 'undefined') return null;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readRecord(key: string): Promise<Record<string, string>> {
  try {
    const opening = openDb();
    if (!opening) return {};
    const db = await opening;
    const record = await new Promise<LocalWorkspaceRecord | undefined>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result as LocalWorkspaceRecord | undefined);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return record?.files ?? {};
  } catch {
    return {};
  }
}

async function writeRecord(key: string, files: Map<string, string> | null): Promise<void> {
  try {
    const opening = openDb();
    if (!opening) return;
    const db = await opening;
    const tx = db.transaction(STORE, 'readwrite');
    if (files) tx.objectStore(STORE).put({ key, files: Object.fromEntries(files) } satisfies LocalWorkspaceRecord);
    else tx.objectStore(STORE).delete(key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // The in-memory copy still holds the write; it simply will not survive a reload.
  }
}

function load(key: string): Promise<Map<string, string>> {
  const cached = memory.get(key);
  if (cached) return Promise.resolve(cached);
  const inFlight = loading.get(key);
  if (inFlight) return inFlight;
  const attempt = readRecord(key).then((files) => {
    // A write that landed while the read was in flight wins over what was on disk.
    const existing = memory.get(key);
    if (existing) return existing;
    const loaded = new Map(Object.entries(files));
    memory.set(key, loaded);
    return loaded;
  }).finally(() => { loading.delete(key); });
  loading.set(key, attempt);
  return attempt;
}

async function mutate(key: string, change: (files: Map<string, string>) => void): Promise<void> {
  const files = await load(key);
  change(files);
  await writeRecord(key, files);
}

/** Every file a local workspace holds, as a path → content map. */
export async function readLocalWorkspace(key: string): Promise<Record<string, string>> {
  return Object.fromEntries(await load(key));
}

/** Fill an EMPTY local workspace. A workspace that already holds files is left alone. */
export async function seedLocalWorkspace(key: string, files: Record<string, string>): Promise<void> {
  await mutate(key, (current) => {
    if (current.size > 0) return;
    for (const [path, content] of Object.entries(files)) current.set(path, content);
  });
}

/** Drop a local workspace — after its files were uploaded into a durable project. */
export async function discardLocalWorkspace(key: string): Promise<void> {
  memory.delete(key);
  await writeRecord(key, null);
}

/** The workspace held in this browser under `key`. */
export function localFileStore(key: string): WorkspaceFileStore {
  const entries = async (): Promise<FileEntry[]> =>
    [...(await load(key)).entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, content]) => ({ path, content, type: 'file' as const }));
  return {
    id: localWorkspaceId(key),
    kind: 'local',
    list: entries,
    read: async (path) => {
      const content = (await load(key)).get(path);
      if (content === undefined) throw new Error(`File not found: ${path}`);
      return content;
    },
    write: (path, content) => mutate(key, (files) => { files.set(path, content); }),
    remove: (path) => mutate(key, (files) => { files.delete(path); }),
    search: async (query) => searchEntries(await entries(), query),
  };
}

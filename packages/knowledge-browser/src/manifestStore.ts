/**
 * The review's `IngestManifest`, persisted in IndexedDB per reviewed root, so a second
 * review of an unchanged folder plans nothing to read (PRD 38 §4.3). Storage is
 * best-effort: when IndexedDB is unavailable or fails, the manifest starts empty — the
 * review plans every file as changed — and writes are dropped. Never an error; the host's
 * reporter hears about it.
 */

import type { ChunkFingerprint, IngestManifest } from '@seanhogg/builderforce-memory/ingest';
import type { KnowledgeDegradedReporter } from './directorySourceKit';

const DB_NAME = 'builderforce-knowledge';
const STORE = 'manifests';

type Record_ = Record<string, ChunkFingerprint[]>;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readRecord(rootId: string): Promise<Record_> {
  const db = await openDb();
  try {
    return await new Promise<Record_>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(rootId);
      req.onsuccess = () => resolve((req.result as Record_ | undefined) ?? {});
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function writeRecord(rootId: string, record: Record_): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record, rootId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** The root's manifest. Every write persists the whole (small) record. */
export async function openManifest(rootId: string, onDegraded: KnowledgeDegradedReporter): Promise<IngestManifest> {
  let record: Record_ = {};
  try {
    if (typeof indexedDB !== 'undefined') record = await readRecord(rootId);
  } catch (error) {
    // Plan as everything changed: a review with no manifest is slower, never wrong.
    onDegraded('manifest read', error, { rootId });
    record = {};
  }
  const persist = async () => {
    try {
      if (typeof indexedDB !== 'undefined') await writeRecord(rootId, record);
    } catch (error) {
      // Best-effort: the next review re-plans what was not kept.
      onDegraded('manifest write', error, { rootId });
    }
  };
  return {
    async get(sourceId) { return record[sourceId]; },
    async set(sourceId, fingerprints) { record = { ...record, [sourceId]: fingerprints }; await persist(); },
    async delete(sourceId) {
      record = { ...record };
      delete record[sourceId];
      await persist();
    },
  };
}

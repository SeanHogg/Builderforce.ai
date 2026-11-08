/**
 * The owner's speaker-embedding cache for the free on-device synthesis path.
 *
 * The embedding is the owner's biometric. The server keeps the canonical copy,
 * sealed at rest, and returns it ONLY to the owner's own authenticated session
 * (never to buyers/other users, never in list/marketplace payloads). This device
 * keeps an IndexedDB cache; a miss falls back to the owner fetch, so the clone
 * follows the owner to any device instead of being bound to one browser.
 *
 * Legacy `bf_voice_emb_<id>` localStorage entries are migrated once: uploaded to
 * the server if it lacks one, moved into IndexedDB, then the key is deleted.
 */

import { getStoredUser, onSessionCleared } from './auth';
import { createIdbKeyValue, type IdbKeyValue } from './idbKeyValue';
import { localStore, readLocal, removeLocal } from './storage';
import { fetchCloneEmbedding, uploadCloneEmbedding } from './voiceClones';

type Embedding = import('./voiceEngine').SpeakerEmbedding;

const LEGACY_PREFIX = 'bf_voice_emb_';
/** The pre-namespacing database: shared by every account on this browser. Dropped on first use. */
const SHARED_LEGACY_DB = 'builderforce-voice';

/**
 * The embedding is a biometric, so the cache is PER USER: one IndexedDB database per
 * signed-in user id, so a hit always belongs to the current user and one account can
 * never read (or inherit) another's. Signing out wipes every cache this tab opened plus
 * the signed-out user's persisted one.
 */
const storesByUser = new Map<string, IdbKeyValue<Embedding>>();
/** Clone ids the server already told us have no embedding for this user (licensed / none) —
 *  skip the round-trip for the rest of the tab. Keyed `${userId}:${cloneId}`. */
const knownAbsent = new Set<string>();
let legacyDbDropped = false;

function dropSharedLegacyDb(): void {
  if (legacyDbDropped) return;
  legacyDbDropped = true;
  try {
    if (typeof indexedDB !== 'undefined') indexedDB.deleteDatabase(SHARED_LEGACY_DB);
  } catch {
    legacyDbDropped = false; // not dropped: the next cache open tries again
  }
}

function cacheFor(userId: string): IdbKeyValue<Embedding> {
  dropSharedLegacyDb();
  let store = storesByUser.get(userId);
  if (!store) {
    store = createIdbKeyValue<Embedding>(`${SHARED_LEGACY_DB}:${userId}`, 'embeddings');
    storesByUser.set(userId, store);
  }
  return store;
}

function currentUserId(): string | null {
  const id = getStoredUser()?.id;
  return id == null || id === '' ? null : String(id);
}

export async function saveEmbedding(cloneId: number, embedding: Embedding): Promise<void> {
  const userId = currentUserId();
  if (!userId) return;
  knownAbsent.delete(`${userId}:${cloneId}`);
  await cacheFor(userId).put(String(cloneId), embedding);
}

/** Cache hit (this user's), else the owner fetch (then cached). Null when this user has none. */
export async function loadEmbedding(cloneId: number): Promise<Embedding | null> {
  const userId = currentUserId();
  if (!userId) return null;
  const cache = cacheFor(userId);
  const hit = await cache.get(String(cloneId));
  if (hit) return hit;
  const absentKey = `${userId}:${cloneId}`;
  if (knownAbsent.has(absentKey)) return null;
  const own = await fetchCloneEmbedding(cloneId);
  // No sample rate (a pre-sealing row) ⇒ the on-device engine can't use it safely;
  // the clone falls back to the server path rather than a guessed rate.
  if (!own || !own.sampleRate) {
    knownAbsent.add(absentKey);
    return null;
  }
  const embedding: Embedding = { data: own.embedding, dim: own.embedding.length, sampleRate: own.sampleRate };
  // The user may have changed while the fetch was in flight — never cache under the wrong account.
  if (currentUserId() === userId) await cache.put(String(cloneId), embedding);
  return embedding;
}

export async function hasCachedEmbedding(cloneId: number): Promise<boolean> {
  const userId = currentUserId();
  if (!userId) return false;
  return Boolean(await cacheFor(userId).get(String(cloneId)));
}

export async function deleteEmbedding(cloneId: number): Promise<void> {
  const userId = currentUserId();
  if (!userId) return;
  knownAbsent.delete(`${userId}:${cloneId}`);
  await cacheFor(userId).delete(String(cloneId));
}

/** Sign-out: wipe the in-memory copies and the persisted cache of every user this tab touched, including the one leaving. */
export function clearEmbeddingCaches(): void {
  const leaving = currentUserId();
  const toClear = new Set<string>(storesByUser.keys());
  if (leaving) toClear.add(leaving);
  for (const userId of toClear) void cacheFor(userId).clear();
  storesByUser.clear();
  knownAbsent.clear();
  migrating = null;
}

onSessionCleared(clearEmbeddingCaches);

let migrating: Promise<void> | null = null;

/** One-time move of localStorage embeddings → server (if missing) + IndexedDB. */
export function migrateLegacyEmbeddings(): Promise<void> {
  migrating ??= migrate();
  return migrating;
}

async function migrate(): Promise<void> {
  const userId = currentUserId();
  if (!userId) return;
  const store = localStore();
  if (!store) return;
  let keys: string[];
  try {
    keys = Object.keys(store).filter((k) => k.startsWith(LEGACY_PREFIX));
  } catch {
    return;
  }
  let incomplete = false;
  for (const key of keys) {
    const cloneId = Number(key.slice(LEGACY_PREFIX.length));
    try {
      const raw = readLocal(key);
      const embedding = raw ? (JSON.parse(raw) as Embedding) : null;
      if (!embedding || !Array.isArray(embedding.data) || !Number.isInteger(cloneId)) {
        removeLocal(key);
        continue;
      }
      const outcome = await uploadCloneEmbedding(cloneId, embedding.data, embedding.sampleRate ?? null);
      // 'retry' = transient; 'forbidden' = not this user's clone, so the key may be another
      // account's only copy. Either way keep the key. Only a 404 ('refused') drops it.
      if (outcome === 'retry' || outcome === 'forbidden') continue;
      if (outcome === 'done') await cacheFor(userId).put(String(cloneId), embedding);
      removeLocal(key);
    } catch {
      incomplete = true; // leave the key; a later call to migrateLegacyEmbeddings runs again
    }
  }
  if (incomplete) migrating = null;
}

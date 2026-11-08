/**
 * How a collaboration room's encoded Yjs state sits in Durable Object storage.
 *
 * A single storage value is limited to ~2 MB, and a heavy drawing used to push the whole Y state past
 * it (every persist then failed). A state larger than one chunk is therefore written as
 * `ydoc:v2:0..n-1` plus `ydoc:v2:count`, in ONE atomic `put` of the entries. A state that fits one
 * chunk keeps the original single `ydoc:v1` value, so every existing room reads and writes exactly
 * as before. A load prefers the chunk set when `ydoc:v2:count` is present and falls back to the
 * single value (also if a chunk is missing).
 */

/** The original single value, and still what a small state is written as. Versioned so a future encoding is distinguishable. */
export const DOC_KEY = 'ydoc:v1';
export const CHUNK_COUNT_KEY = 'ydoc:v2:count';
export const chunkKey = (index: number): string => `ydoc:v2:${index}`;
/** Under the ~2 MB single-value limit with room for the storage engine's own overhead. */
export const CHUNK_BYTES = 1_000_000;

/** What storage currently holds, so a save can delete what it supersedes. */
export interface StoredShape { chunks: number; legacy: boolean }
export const EMPTY_SHAPE: StoredShape = { chunks: 0, legacy: false };

type Bytes = ArrayBuffer | Uint8Array;
const toBytes = (value: Bytes): Uint8Array => (value instanceof Uint8Array ? value : new Uint8Array(value));

export async function loadRoomState(storage: DurableObjectStorage | undefined): Promise<{ bytes: Uint8Array | null; shape: StoredShape }> {
  if (!storage) return { bytes: null, shape: EMPTY_SHAPE };
  const count = await storage.get<number>(CHUNK_COUNT_KEY);
  if (typeof count === 'number' && count > 0) {
    const keys = Array.from({ length: count }, (_, index) => chunkKey(index));
    const found = await storage.get<Bytes>(keys);
    const parts = keys.map((key) => found.get(key));
    if (parts.every((part): part is Bytes => part !== undefined)) {
      const chunks = parts.map(toBytes);
      const joined = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
      let offset = 0;
      for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
      return { bytes: joined, shape: { chunks: count, legacy: false } };
    }
  }
  const single = await storage.get<Bytes>(DOC_KEY);
  return { bytes: single ? toBytes(single) : null, shape: { chunks: typeof count === 'number' ? count : 0, legacy: !!single } };
}

/** Persist `update`; returns the new shape. New data is written before the superseded keys are deleted. */
export async function saveRoomState(storage: DurableObjectStorage | undefined, update: Uint8Array, prior: StoredShape): Promise<StoredShape> {
  if (!storage) return prior;
  if (update.byteLength <= CHUNK_BYTES) {
    await storage.put(DOC_KEY, update);
    if (prior.chunks > 0) await storage.delete([CHUNK_COUNT_KEY, ...Array.from({ length: prior.chunks }, (_, index) => chunkKey(index))]);
    return { chunks: 0, legacy: true };
  }
  const count = Math.ceil(update.byteLength / CHUNK_BYTES);
  const entries: Record<string, number | Uint8Array> = { [CHUNK_COUNT_KEY]: count };
  for (let index = 0; index < count; index += 1) entries[chunkKey(index)] = update.slice(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES);
  await storage.put(entries);
  const stale = [
    ...(prior.legacy ? [DOC_KEY] : []),
    ...Array.from({ length: Math.max(0, prior.chunks - count) }, (_, index) => chunkKey(count + index)),
  ];
  if (stale.length > 0) await storage.delete(stale);
  return { chunks: count, legacy: false };
}

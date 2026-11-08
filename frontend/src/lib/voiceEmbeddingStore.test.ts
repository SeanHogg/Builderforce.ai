import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchCloneEmbedding = vi.fn();
const uploadCloneEmbedding = vi.fn();
vi.mock('./voiceClones', () => ({
  fetchCloneEmbedding: (...a: unknown[]) => fetchCloneEmbedding(...a),
  uploadCloneEmbedding: (...a: unknown[]) => uploadCloneEmbedding(...a),
}));

let currentUser: { id: string } | null = { id: 'user-a' };
const { clearHooks } = vi.hoisted(() => ({ clearHooks: [] as Array<() => void> }));
vi.mock('./auth', () => ({
  getStoredUser: () => currentUser,
  onSessionCleared: (fn: () => void) => { clearHooks.push(fn); return () => {}; },
}));

import { deleteEmbedding, hasCachedEmbedding, loadEmbedding, migrateLegacyEmbeddings } from './voiceEmbeddingStore';

function installLocalStorage(initial: Record<string, string>) {
  const data = new Map(Object.entries(initial));
  const ls = {
    getItem: (k: string) => data.get(k) ?? null,
    removeItem: (k: string) => { data.delete(k); },
    setItem: (k: string, v: string) => { data.set(k, v); },
  };
  // `Object.keys(localStorage)` must list the entries.
  const proxy = new Proxy(ls, { ownKeys: () => [...data.keys()], getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) });
  vi.stubGlobal('localStorage', proxy);
  vi.stubGlobal('window', { localStorage: proxy }); // `lib/storage` reaches the store through `window`
  return data;
}

beforeEach(() => {
  currentUser = { id: 'user-a' };
  fetchCloneEmbedding.mockReset();
  uploadCloneEmbedding.mockReset();
});

describe('voiceEmbeddingStore', () => {
  it('cache miss → owner fetch → cached (second load does not refetch)', async () => {
    fetchCloneEmbedding.mockResolvedValue({ embedding: [1, 2], sampleRate: 16000 });
    const first = await loadEmbedding(101);
    expect(first).toEqual({ data: [1, 2], dim: 2, sampleRate: 16000 });
    expect(await loadEmbedding(101)).toEqual(first);
    expect(fetchCloneEmbedding).toHaveBeenCalledTimes(1);
    expect(await hasCachedEmbedding(101)).toBe(true);
    await deleteEmbedding(101);
    expect(await hasCachedEmbedding(101)).toBe(false);
  });

  it('server has none (403/404) → null, and is not re-asked this tab', async () => {
    fetchCloneEmbedding.mockResolvedValue(null);
    expect(await loadEmbedding(102)).toBeNull();
    expect(await loadEmbedding(102)).toBeNull();
    expect(fetchCloneEmbedding).toHaveBeenCalledTimes(1);
  });

  it('migrates localStorage entries: upload, cache, delete key; keeps the key on transient failure', async () => {
    const ok = { data: [3, 4], dim: 2, sampleRate: 16000 };
    const data = installLocalStorage({
      bf_voice_emb_201: JSON.stringify(ok),
      bf_voice_emb_202: JSON.stringify(ok),
      other_key: 'x',
    });
    uploadCloneEmbedding.mockImplementation(async (id: number) => (id === 201 ? 'done' : 'retry'));
    await migrateLegacyEmbeddings();
    expect(uploadCloneEmbedding).toHaveBeenCalledWith(201, [3, 4], 16000);
    expect(data.has('bf_voice_emb_201')).toBe(false);
    expect(data.has('bf_voice_emb_202')).toBe(true);
    expect(data.has('other_key')).toBe(true);
    expect(await hasCachedEmbedding(201)).toBe(true);
    vi.unstubAllGlobals();
  });

  it("user A's cache is invisible to user B", async () => {
    fetchCloneEmbedding.mockResolvedValue({ embedding: [9, 9], sampleRate: 16000 });
    await loadEmbedding(301);
    expect(await hasCachedEmbedding(301)).toBe(true);
    currentUser = { id: 'user-b' };
    expect(await hasCachedEmbedding(301)).toBe(false);
    fetchCloneEmbedding.mockResolvedValue(null);
    expect(await loadEmbedding(301)).toBeNull();
  });

  it('sign-out clears the cache', async () => {
    fetchCloneEmbedding.mockResolvedValue({ embedding: [5, 6], sampleRate: 16000 });
    await loadEmbedding(302);
    expect(await hasCachedEmbedding(302)).toBe(true);
    for (const hook of clearHooks) hook();
    await new Promise((r) => setTimeout(r, 0));
    expect(await hasCachedEmbedding(302)).toBe(false);
  });

  it('migration keeps the key on 403 (forbidden) and drops it only on 404 (refused)', async () => {
    const emb = { data: [1, 2], dim: 2, sampleRate: 16000 };
    const data = installLocalStorage({
      bf_voice_emb_401: JSON.stringify(emb),
      bf_voice_emb_402: JSON.stringify(emb),
    });
    uploadCloneEmbedding.mockImplementation(async (id: number) => (id === 401 ? 'forbidden' : 'refused'));
    await migrateLegacyEmbeddings();
    expect(data.has('bf_voice_emb_401')).toBe(true);
    expect(data.has('bf_voice_emb_402')).toBe(false);
    vi.unstubAllGlobals();
  });
});

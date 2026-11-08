import { describe, expect, it } from "vitest";
import { sha256Hex } from "@seanhogg/builderforce-memory/knowledge";
import { HASH_CACHE_FILE, HASH_CACHE_MAX_ENTRIES, nodeSha256Hex, persistentHashCache } from "./hashCacheFile";
import type { HashCache } from "./vscodeDirectorySource";

const memoryFiles = (initial?: string) => {
  const store = new Map<string, string>(initial === undefined ? [] : [[HASH_CACHE_FILE, initial]]);
  return { store, files: { read: async (n: string) => store.get(n), write: async (n: string, t: string) => { store.set(n, t); } } as never };
};

describe("nodeSha256Hex", () => {
  it("is the same lowercase hex digest as memory's sha256Hex", () => {
    for (const text of ["", "abc", "héllo wörld\n".repeat(1000)]) {
      const bytes = new TextEncoder().encode(text);
      expect(nodeSha256Hex(bytes)).toBe(sha256Hex(bytes));
    }
    expect(nodeSha256Hex(new Uint8Array(70_000).fill(255))).toBe(sha256Hex(new Uint8Array(70_000).fill(255)));
  });
});

describe("persistentHashCache", () => {
  it("round-trips this root's entries to a new process and leaves other roots out", async () => {
    const { files, store } = memoryFiles();
    const cache: HashCache = new Map([["/w/a.ts", { mtime: 1, size: 2, hash: "h" }], ["/other/b.ts", { mtime: 1, size: 2, hash: "x" }]]);
    await persistentHashCache(files, "/w", cache).save();
    const reloaded: HashCache = new Map();
    // A fresh module scope would be a new process: a different root path keeps this test independent of the load-once memo.
    await persistentHashCache({ read: async () => store.get(HASH_CACHE_FILE), write: async () => undefined } as never, "/w", reloaded).load();
    expect([...reloaded.keys()]).toEqual(["/w/a.ts"]);
  });

  it("starts empty from a corrupt file", async () => {
    const { files } = memoryFiles("{not json");
    const cache: HashCache = new Map();
    await persistentHashCache(files, "/corrupt", cache).load();
    expect(cache.size).toBe(0);
  });

  it("keeps at most the newest entries", async () => {
    const { files, store } = memoryFiles();
    const cache: HashCache = new Map();
    for (let i = 0; i < HASH_CACHE_MAX_ENTRIES + 10; i++) cache.set(`/big/f${i}`, { mtime: 1, size: 1, hash: "h" });
    await persistentHashCache(files, "/big", cache).save();
    const saved = JSON.parse(store.get(HASH_CACHE_FILE)!) as { rows: Array<[string]> };
    expect(saved.rows).toHaveLength(HASH_CACHE_MAX_ENTRIES);
    expect(saved.rows.at(-1)![0]).toBe(`/big/f${HASH_CACHE_MAX_ENTRIES + 9}`);
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { filesManifestKey, srcRef, type Extracted } from "@seanhogg/builderforce-memory/knowledge";
import { decodePack, manifestTree } from "@seanhogg/builderforce-memory/knowledge/pack";
import { dirtyFileName, replicaFileName } from "@builderforce/agent-tools/knowledge";
import type { KnowledgeClient } from "@builderforce/knowledge-client";
import { localSqliteAvailable } from "@builderforce/agent-tools/node-local-sqlite";
import { nodeKnowledgeStore, type NodeKnowledgeStore } from "@builderforce/agent-tools/node-knowledge-store";
import { snapshotFileName, type KnowledgeFiles } from "./knowledgeStores";
import { disposeReplicas, queueFirstSyncOnce, replicaDrained, replicaQueueFor, replicaStatusOf, resumeAuthPaused, type UploadMarks } from "./knowledgeReplica";

type Files = KnowledgeFiles & { data: Map<string, string>; renames: string[] };
function memoryFiles(): Files {
  const data = new Map<string, string>();
  const renames: string[] = [];
  return {
    data, renames,
    read: async (n) => data.get(n),
    write: async (n, t) => { data.set(n, t); },
    rename: async (from, to) => { renames.push(`${from}>${to}`); data.set(to, data.get(from)!); data.delete(from); },
    remove: async (n) => { data.delete(n); },
  };
}

const apiError = (status: number, retryAfterMs?: number) => Object.assign(new Error(`knowledge API ${status}`), { status, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) });

/** A project that holds nothing for the root: the first sync is one full pack. `sync` can be made to fail. */
function fakeClient(over: { sync?: () => Promise<void> } = {}) {
  const empty = manifestTree([]);
  const packs: Uint8Array[] = [];
  const sync = vi.fn(async (_root: string, part: { bytes: Uint8Array }) => {
    await over.sync?.();
    packs.push(part.bytes);
    return { applied: true as const, generation: packs.length, digest: "d" };
  });
  const client = {
    store: { scopes: vi.fn(async () => []), facts: vi.fn(async () => []), relations: vi.fn(async () => []) },
    sync,
    syncManifest: vi.fn(async () => ({ generation: 0, digest: empty.root, buckets: empty.buckets })),
    syncLeaves: vi.fn(async () => ({ generation: 0, leaves: [] })),
    syncHave: vi.fn(async (_r: string, hashes: string[]) => hashes.map(() => false)),
    putAnalysis: vi.fn(async () => undefined),
  } as unknown as KnowledgeClient;
  return { client, sync, packs };
}

function marks(): UploadMarks & { map: Map<string, number> } {
  const map = new Map<string, number>();
  return { map, get: (r) => map.get(r), set: async (r, p) => { map.set(r, p); } };
}

const ROOT = "repo/docs";

// The local store is the folder's SQLite store (G03): a fresh temp folder per test, closed afterwards. Skips where node:sqlite is absent.
const opened: NodeKnowledgeStore[] = [];
const folders: string[] = [];
const nodeStore = (): NodeKnowledgeStore => {
  const dir = mkdtempSync(join(tmpdir(), "bf-knowledge-stores-"));
  folders.push(dir);
  const k = nodeKnowledgeStore(dir);
  opened.push(k);
  return k;
};

afterEach(async () => {
  await disposeReplicas();
  for (const k of opened.splice(0)) k.close();
  for (const d of folders.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("knowledge store", () => {
  it("names files safely and uniquely per root", () => {
    expect(snapshotFileName("a/b:c")).toMatch(/^a_b_c-[0-9a-f]{10}\.json$/);
    expect(snapshotFileName("a/b")).not.toBe(snapshotFileName("a_b"));
  });
});

describe.skipIf(!localSqliteAvailable())("linking owes the local snapshot to the replica pump as one pack", () => {
  async function reviewedLocally(files: Files) {
    const { store, manifest } = nodeStore();
    const ref = srcRef(ROOT, "lease.md");
    const ex: Extracted = { sourceRef: ref, sourceHash: "h1", nodes: [], edges: [], keys: [] };
    await store.putExtracted!("h1", [ex]);
    await store.putExtracted!("h0", [{ ...ex, sourceHash: "h0" }]); // an older version, not current
    await store.write({
      scope: { rootId: ROOT, title: "docs", packs: ["docs"] },
      facts: [{ key: "claim:1", content: "c", source: "knowledge-review", importance: 0.5, origin: "model", fileAnchors: [{ path: "lease.md", contentHash: "h1" }] }],
      relations: [{ from: "fact:claim:1", to: ref, kind: "about", weight: 1, origin: "model" }],
    });
    await manifest.set(filesManifestKey(ROOT), [{ id: "lease.md", hash: "h1" }]);
    return { store, manifest };
  }

  const sync = (files: KnowledgeFiles, held: Pick<NodeKnowledgeStore, "store" | "manifest">, client: KnowledgeClient, projectId: number, m: UploadMarks) =>
    queueFirstSyncOnce({ rootId: ROOT, files, local: held.store, client, projectId, manifest: held.manifest, marks: m });

  it("sends each source's CURRENT output, the rows and the scope in ONE pack, once per project; the mark is set when the set has drained", async () => {
    const files = memoryFiles();
    const local = await reviewedLocally(files);
    const a = fakeClient();
    const m = marks();
    expect(await sync(files, local, a.client, 7, m)).toBe(true);
    await replicaDrained(ROOT);
    expect(a.sync).toHaveBeenCalledTimes(1);
    const pack = await decodePack(a.packs[0]!);
    expect(pack.baseGeneration).toBe(0);
    expect(pack.files).toEqual([{ path: "lease.md", hash: "h1", bytes: 0 }]);
    expect(pack.extracted?.map((x) => x.hash)).toEqual(["h1"]);
    expect(pack.facts).toEqual([expect.objectContaining({ key: "claim:1" })]);
    expect(pack.relations).toEqual([expect.objectContaining({ kind: "about" })]);
    expect(pack.scope).toMatchObject({ rootId: ROOT });
    expect(m.map.get(ROOT)).toBe(7);

    expect(await sync(files, local, a.client, 7, m)).toBe(false);
    expect(a.sync).toHaveBeenCalledTimes(1);

    // Linked to ANOTHER project: that project receives the data, the old set is gone.
    const b = fakeClient();
    expect(await sync(files, local, b.client, 8, m)).toBe(true);
    await replicaDrained(ROOT);
    expect(b.sync).toHaveBeenCalledTimes(1);
    expect(m.map.get(ROOT)).toBe(8);
    expect(await replicaQueueFor(ROOT, files).size()).toBe(0);
    expect(a.sync).toHaveBeenCalledTimes(1);
  });

  it("switching project while a pump waits on a 429 sends nothing of B to A, and B receives its first sync", async () => {
    const files = memoryFiles();
    const local = await reviewedLocally(files);
    const a = fakeClient({ sync: async () => { throw apiError(429, 600_000); } });
    const b = fakeClient();
    const m = marks();
    await sync(files, local, a.client, 7, m);
    await vi.waitFor(async () => expect((await replicaStatusOf(ROOT, files)).waitingUntil).toBeDefined());
    await sync(files, local, b.client, 8, m);
    await replicaDrained(ROOT);
    expect(a.packs).toHaveLength(0);
    expect(b.sync).toHaveBeenCalledTimes(1);
    expect(m.map.get(ROOT)).toBe(8); // project 7 never drained, so it was never marked
  });

  it("an expired token keeps the whole dirty set and does not mark the first sync done", async () => {
    const files = memoryFiles();
    const local = await reviewedLocally(files);
    let signedIn = false;
    const a = fakeClient({ sync: async () => { if (!signedIn) throw apiError(401); } });
    const m = marks();
    await sync(files, local, a.client, 7, m);
    await replicaDrained(ROOT);
    const status = await replicaStatusOf(ROOT, files);
    expect(status).toMatchObject({ paused: "auth", failed: [] });
    expect(status.dirty).toBeGreaterThan(0);
    expect(m.map.has(ROOT)).toBe(false);
    expect(a.packs).toHaveLength(0);

    // The person signs in again: the paused pump resumes, drains the intact set, and the first sync is marked.
    signedIn = true;
    await resumeAuthPaused();
    await replicaDrained(ROOT);
    expect(await replicaStatusOf(ROOT, files)).toMatchObject({ dirty: 0, failed: [] });
    expect((await replicaStatusOf(ROOT, files)).paused).toBeUndefined();
    expect(a.packs).toHaveLength(1);
    expect(m.map.get(ROOT)).toBe(7);
  });

  it("a dirty-set file that does not parse is kept aside and the first sync is owed again, whatever the mark says", async () => {
    const files = memoryFiles();
    const local = await reviewedLocally(files);
    files.data.set(dirtyFileName(ROOT), "{ truncated");
    const a = fakeClient();
    const m = marks();
    m.map.set(ROOT, 7); // the old mark says it was done; the set that held the proof is lost
    expect(await sync(files, local, a.client, 7, m)).toBe(true);
    await replicaDrained(ROOT);
    expect(files.data.get(`${dirtyFileName(ROOT)}.corrupt`)).toBe("{ truncated");
    expect(a.sync).toHaveBeenCalledTimes(1);
  });

  it("writes the dirty set atomically (temp, then rename), only when it changed, and dispose makes it durable first", async () => {
    const files = memoryFiles();
    replicaQueueFor(ROOT, files).markDirty(["f:h9.md"]);
    expect(files.data.has(dirtyFileName(ROOT))).toBe(false); // throttled: not yet saved
    await disposeReplicas();
    expect(files.data.get(dirtyFileName(ROOT))).toContain("f:h9.md");
    expect(files.renames).toEqual([`${dirtyFileName(ROOT)}.tmp>${dirtyFileName(ROOT)}`]);
  });

  it("converts an op log an older version left to dirty keys, then deletes it", async () => {
    const files = memoryFiles();
    files.data.set(replicaFileName(ROOT), JSON.stringify({ version: 1, ops: [{ op: "write", rootId: ROOT, facts: ["claim:9"], relations: [] }] }));
    const queue = replicaQueueFor(ROOT, files);
    expect((await queue.snapshot()).keys).toEqual(["a:claim:9"]);
    expect(files.data.has(replicaFileName(ROOT))).toBe(false);
  });

  it("owes nothing for a root never reviewed locally", async () => {
    const { client } = fakeClient();
    const files = memoryFiles();
    expect(await sync(files, nodeStore(), client, 7, marks())).toBe(false);
  });
});

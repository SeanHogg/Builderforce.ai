import { afterEach, describe, expect, it, vi } from "vitest";
import { filesManifestKey, srcRef, type Extracted } from "@seanhogg/builderforce-memory/knowledge";
import { replicaFileName } from "@builderforce/agent-tools/knowledge";
import type { KnowledgeClient } from "@builderforce/knowledge-client";
import {
  fileManifest, localKnowledgeStore, manifestFileName, snapshotFileName,
  type KnowledgeFiles,
} from "./knowledgeStores";
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
  };
}

const apiError = (status: number, retryAfterMs?: number) => Object.assign(new Error(`knowledge API ${status}`), { status, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) });

function fakeClient(over: { putExtracted?: () => Promise<void> } = {}) {
  const store = {
    scopes: vi.fn(async () => []),
    facts: vi.fn(async () => []),
    relations: vi.fn(async () => []),
    write: vi.fn(async () => undefined),
    markStale: vi.fn(async () => undefined),
  };
  // Typed with the client's own parameters, so the mock's calls are `[hash, extracted]` tuples.
  const impl: (hash: string, extracted: unknown[]) => Promise<void> = over.putExtracted ?? (async () => undefined);
  const putExtracted = vi.fn(impl);
  const writeRows = vi.fn(async () => undefined);
  const client = { store, putExtracted, writeRows, putAnalysis: vi.fn(async () => undefined) } as unknown as KnowledgeClient;
  return { client, store, putExtracted, writeRows };
}

function marks(): UploadMarks & { map: Map<string, number> } {
  const map = new Map<string, number>();
  return { map, get: (r) => map.get(r), set: async (r, p) => { map.set(r, p); } };
}

const ROOT = "repo/docs";

afterEach(async () => { await disposeReplicas(); });

describe("knowledge store", () => {
  it("keeps a folder in its local snapshot, linked or not", async () => {
    const files = memoryFiles();
    const local = localKnowledgeStore(files, ROOT);
    await local.write({ scope: { rootId: ROOT, title: "docs", packs: ["docs"] }, facts: [], relations: [] });
    expect(files.data.has(snapshotFileName(ROOT))).toBe(true);
  });

  it("names files safely and uniquely per root", () => {
    expect(snapshotFileName("a/b:c")).toMatch(/^a_b_c-[0-9a-f]{10}\.json$/);
    expect(snapshotFileName("a/b")).not.toBe(snapshotFileName("a_b"));
  });

  it("persists the review manifest whole", async () => {
    const files = memoryFiles();
    const m = fileManifest(files, "m.json");
    await m.set("k", [{ id: "a.md", hash: "1" }]);
    expect(await fileManifest(files, "m.json").get("k")).toEqual([{ id: "a.md", hash: "1" }]);
  });
});

describe("linking queues the local snapshot for the replica pump", () => {
  async function reviewedLocally(files: Files) {
    const store = localKnowledgeStore(files, ROOT);
    const ref = srcRef(ROOT, "lease.md");
    const ex: Extracted = { sourceRef: ref, sourceHash: "h1", nodes: [], edges: [], keys: [] };
    await store.putExtracted!("h1", [ex]);
    await store.putExtracted!("h0", [{ ...ex, sourceHash: "h0" }]); // an older version, not current
    await store.write({
      scope: { rootId: ROOT, title: "docs", packs: ["docs"] },
      facts: [{ key: "claim:1", content: "c", source: "knowledge-review", importance: 0.5, origin: "model", fileAnchors: [{ path: "lease.md", contentHash: "h1" }] }],
      relations: [{ from: "fact:claim:1", to: ref, kind: "about", weight: 1, origin: "model" }],
    });
    await fileManifest(files, manifestFileName(ROOT)).set(filesManifestKey(ROOT), [{ id: "lease.md", hash: "h1" }]);
    return store;
  }

  const sync = (files: KnowledgeFiles, local: ReturnType<typeof localKnowledgeStore>, client: KnowledgeClient, projectId: number, m: UploadMarks) =>
    queueFirstSyncOnce({ rootId: ROOT, files, local, client, projectId, manifest: fileManifest(files, manifestFileName(ROOT)), marks: m });

  it("sends each source's CURRENT output, then the rows, then the scope, once per project; the mark is set when the queue has drained", async () => {
    const files = memoryFiles();
    const local = await reviewedLocally(files);
    const a = fakeClient();
    const m = marks();
    expect(await sync(files, local, a.client, 7, m)).toBe(true);
    await replicaDrained(ROOT);
    expect(a.putExtracted).toHaveBeenCalledTimes(1);
    expect(a.putExtracted.mock.calls[0]![0]).toBe("h1");
    expect(a.store.markStale).toHaveBeenCalledWith({ rootId: ROOT }, srcRef(ROOT, "lease.md"), "h1");
    expect(a.writeRows).toHaveBeenCalledWith(ROOT, { facts: [expect.objectContaining({ key: "claim:1" })], relations: [expect.objectContaining({ kind: "about" })] });
    expect(a.store.write).toHaveBeenCalledWith(expect.objectContaining({ scope: expect.objectContaining({ rootId: ROOT }) }));
    expect(m.map.get(ROOT)).toBe(7);

    expect(await sync(files, local, a.client, 7, m)).toBe(false);
    expect(a.store.write).toHaveBeenCalledTimes(1);

    // Linked to ANOTHER project: that project receives the data, the old queue is gone.
    const b = fakeClient();
    expect(await sync(files, local, b.client, 8, m)).toBe(true);
    await replicaDrained(ROOT);
    expect(b.putExtracted).toHaveBeenCalledTimes(1);
    expect(b.writeRows).toHaveBeenCalledTimes(1);
    expect(b.store.write).toHaveBeenCalledTimes(1);
    expect(m.map.get(ROOT)).toBe(8);
    expect(await replicaQueueFor(ROOT, files).size()).toBe(0);
    expect(a.putExtracted).toHaveBeenCalledTimes(1);
  });

  it("switching project while a pump waits on a 429 sends nothing of B to A, and B receives its first sync", async () => {
    const files = memoryFiles();
    const local = await reviewedLocally(files);
    const a = fakeClient({ putExtracted: async () => { throw apiError(429, 600_000); } });
    const b = fakeClient();
    const m = marks();
    await sync(files, local, a.client, 7, m);
    await vi.waitFor(async () => expect((await replicaStatusOf(ROOT, files)).waitingUntil).toBeDefined());
    await sync(files, local, b.client, 8, m);
    await replicaDrained(ROOT);
    expect(a.writeRows).not.toHaveBeenCalled();
    expect(a.store.write).not.toHaveBeenCalled();
    expect(b.putExtracted).toHaveBeenCalledTimes(1);
    expect(b.writeRows).toHaveBeenCalledTimes(1);
    expect(b.store.write).toHaveBeenCalledTimes(1);
    expect(m.map.get(ROOT)).toBe(8); // project 7 never drained, so it was never marked
  });

  it("an expired token keeps the whole queue and does not mark the first sync done", async () => {
    const files = memoryFiles();
    const local = await reviewedLocally(files);
    let signedIn = false;
    const a = fakeClient({ putExtracted: async () => { if (!signedIn) throw apiError(401); } });
    const m = marks();
    await sync(files, local, a.client, 7, m);
    await replicaDrained(ROOT);
    const status = await replicaStatusOf(ROOT, files);
    expect(status).toMatchObject({ paused: "auth", queued: 4, failed: [] });
    expect(m.map.has(ROOT)).toBe(false);
    expect(a.writeRows).not.toHaveBeenCalled();

    // The person signs in again: the paused pump resumes, drains the intact queue, and the first sync is marked.
    signedIn = true;
    await resumeAuthPaused();
    await replicaDrained(ROOT);
    expect(await replicaStatusOf(ROOT, files)).toMatchObject({ queued: 0, failed: [] });
    expect((await replicaStatusOf(ROOT, files)).paused).toBeUndefined();
    expect(a.writeRows).toHaveBeenCalledTimes(1);
    expect(m.map.get(ROOT)).toBe(7);
  });

  it("a queue that does not parse is kept aside and the first sync is queued again, whatever the mark says", async () => {
    const files = memoryFiles();
    const local = await reviewedLocally(files);
    files.data.set(replicaFileName(ROOT), "{ truncated");
    const a = fakeClient();
    const m = marks();
    m.map.set(ROOT, 7); // the old mark says it was done; the queue that held the proof is lost
    expect(await sync(files, local, a.client, 7, m)).toBe(true);
    await replicaDrained(ROOT);
    expect(files.data.get(`${replicaFileName(ROOT)}.corrupt`)).toBe("{ truncated");
    expect(a.writeRows).toHaveBeenCalledTimes(1);
  });

  it("writes the queue atomically (temp, then rename), and dispose makes every queue durable first", async () => {
    const files = memoryFiles();
    await replicaQueueFor(ROOT, files).enqueue({ op: "putExtracted", hash: "h9" });
    expect(files.data.has(replicaFileName(ROOT))).toBe(false); // throttled: not yet saved
    await disposeReplicas();
    expect(files.data.get(replicaFileName(ROOT))).toContain("h9");
    expect(files.renames).toEqual([`${replicaFileName(ROOT)}.tmp>${replicaFileName(ROOT)}`]);
  });

  it("queues nothing for a root never reviewed locally", async () => {
    const { client } = fakeClient();
    const files = memoryFiles();
    expect(await sync(files, localKnowledgeStore(files, ROOT), client, 7, marks())).toBe(false);
  });
});

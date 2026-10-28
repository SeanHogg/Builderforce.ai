import { describe, expect, it, vi } from "vitest";
import { filesManifestKey, srcRef, type Extracted } from "@seanhogg/builderforce-memory/knowledge";
import type { KnowledgeClient } from "@builderforce/knowledge-client";
import {
  fileManifest, localKnowledgeStore, manifestFileName, selectKnowledgeStore, snapshotFileName, uploadLocalSnapshot,
  type KnowledgeFiles, type UploadMarks,
} from "./knowledgeStores";

function memoryFiles(): KnowledgeFiles & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, read: async (n) => data.get(n), write: async (n, t) => { data.set(n, t); } };
}

function fakeClient() {
  const store = {
    scopes: vi.fn(async () => []),
    facts: vi.fn(async () => []),
    relations: vi.fn(async () => []),
    write: vi.fn(async () => undefined),
    markStale: vi.fn(async () => undefined),
  };
  const client = { store, putExtracted: vi.fn(async () => undefined) } as unknown as KnowledgeClient;
  return { client, store, putExtracted: (client as unknown as { putExtracted: ReturnType<typeof vi.fn> }).putExtracted };
}

function marks(): UploadMarks & { map: Map<string, number> } {
  const map = new Map<string, number>();
  return { map, get: (r) => map.get(r), set: async (r, p) => { map.set(r, p); } };
}

const ROOT = "repo/docs";

describe("knowledge store selection", () => {
  it("keeps an unlinked folder in its local snapshot, and a linked one on the platform", async () => {
    const files = memoryFiles();
    const local = selectKnowledgeStore({ rootId: ROOT, files });
    expect(local.client).toBeUndefined();
    await local.store.write({ scope: { rootId: ROOT, title: "docs", packs: ["docs"] }, facts: [], relations: [] });
    expect(files.data.has(snapshotFileName(ROOT))).toBe(true);

    const { client } = fakeClient();
    const linked = selectKnowledgeStore({ rootId: ROOT, files, client });
    expect(linked.store).toBe(client.store);
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

describe("linking uploads the local snapshot", () => {
  async function reviewedLocally(files: ReturnType<typeof memoryFiles>) {
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
  }

  it("uploads each source's CURRENT extracted output, then the facts and relations with the scope, once per project", async () => {
    const files = memoryFiles();
    await reviewedLocally(files);
    const { client, store, putExtracted } = fakeClient();
    const m = marks();
    const out = await uploadLocalSnapshot({ rootId: ROOT, files, client, projectId: 7, marks: m });
    expect(out).toEqual({ sources: 1, facts: 1, relations: 1 });
    expect(putExtracted).toHaveBeenCalledTimes(1);
    expect(putExtracted.mock.calls[0]![0]).toBe("h1");
    expect(store.markStale).toHaveBeenCalledWith({ rootId: ROOT }, srcRef(ROOT, "lease.md"), "h1");
    expect(store.write).toHaveBeenCalledWith(expect.objectContaining({ scope: expect.objectContaining({ rootId: ROOT }) }));
    expect(m.map.get(ROOT)).toBe(7);

    expect(await uploadLocalSnapshot({ rootId: ROOT, files, client, projectId: 7, marks: m })).toBeNull();
    expect(store.write).toHaveBeenCalledTimes(1);
    // Linked to ANOTHER project: uploaded there too.
    expect(await uploadLocalSnapshot({ rootId: ROOT, files, client, projectId: 8, marks: m })).not.toBeNull();
  });

  it("uploads nothing for a root never reviewed locally", async () => {
    const { client } = fakeClient();
    expect(await uploadLocalSnapshot({ rootId: ROOT, files: memoryFiles(), client, projectId: 7, marks: marks() })).toBeNull();
  });
});

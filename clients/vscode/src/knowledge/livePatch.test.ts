import { describe, expect, it } from "vitest";
import { InMemoryIngestManifest } from "@seanhogg/builderforce-memory/ingest";
import { filesManifestKey, srcRef, type Extracted, type KEdge, type KNode } from "@seanhogg/builderforce-memory/knowledge";
import { editedManifestKey } from "@builderforce/agent-tools/knowledge";
import { LivePatchBuilder } from "./livePatch";

const ROOT = "r";
const node = (ref: string, kind = "section"): KNode => ({ ref: ref as KNode["ref"], kind, label: ref, pack: "code", importance: 0, origin: "extracted" });
const edge = (from: string, to: string, kind = "references"): KEdge => ({ from: from as KEdge["from"], to: to as KEdge["to"], kind, weight: 1, origin: "extracted" });
const extract = (path: string, hash: string, nodes: KNode[], edges: KEdge[]): Extracted => ({ sourceRef: srcRef(ROOT, path), sourceHash: hash, nodes, edges, keys: [] });

function fixture() {
  const manifest = new InMemoryIngestManifest();
  const cache = new Map<string, Extracted[]>();
  const store = { getExtracted: async (hash: string) => cache.get(hash) };
  const a = srcRef(ROOT, "a.ts");
  return {
    manifest, cache, store, a,
    /** The review's hashes. */
    reviewed: (files: Record<string, string>) => manifest.set(filesManifestKey(ROOT), Object.entries(files).map(([id, hash]) => ({ id, hash }))),
    /** A live edit: the file's hash now, over the review's base. */
    edited: (id: string, hash: string, base: string) => manifest.set(editedManifestKey(ROOT), [{ id, hash: `${hash}|${base}` }]),
  };
}

describe("LivePatchBuilder — a batch's patch from the extracted cache", () => {
  it("diffs the file's old extract (held hash) against its new one: upserts the new, drops what is gone, marks it stale", async () => {
    const f = fixture();
    await f.reviewed({ "a.ts": "h1" });
    f.cache.set("h1", [extract("a.ts", "h1", [node(f.a, "file"), node(`${f.a}#old`)], [edge(`${f.a}#old`, "src:r::b.ts"), edge(f.a, "src:r::c.ts")])]);
    f.cache.set("h2", [extract("a.ts", "h2", [node(f.a, "file"), node(`${f.a}#new`)], [edge(f.a, "src:r::c.ts")])]);
    const builder = new LivePatchBuilder({ rootId: ROOT, store: f.store, manifest: f.manifest });
    await builder.rebase();
    await f.edited("a.ts", "h2", "h1");

    const patch = await builder.build(["a.ts"], ["a.ts"]);
    expect(patch.files).toEqual([f.a]);
    expect(patch.removedNodes).toEqual([`${f.a}#old`]);
    expect(patch.upsertNodes.map((n) => n.ref)).toEqual([f.a, `${f.a}#new`]);
    expect(patch.removedEdges).toEqual([{ from: `${f.a}#old`, to: "src:r::b.ts", kind: "references" }]);
    expect(patch.upsertEdges).toHaveLength(1);
    expect(patch.stale).toEqual([f.a]);
    expect(patch.changed).toEqual(["a.ts"]);

    // The held hash moved forward: the same batch again moves nothing.
    expect((await builder.build(["a.ts"], ["a.ts"])).files).toEqual([]);
  });

  it("reads only the file's own entry when files with equal content share a hash", async () => {
    const f = fixture();
    await f.reviewed({ "a.ts": "h1" });
    f.cache.set("h2", [extract("twin.ts", "h2", [node("src:r::twin.ts", "file")], []), extract("a.ts", "h2", [node(f.a, "file")], [])]);
    const builder = new LivePatchBuilder({ rootId: ROOT, store: f.store, manifest: f.manifest });
    await builder.rebase();
    await f.edited("a.ts", "h2", "h1");
    expect((await builder.build(["a.ts"], [])).upsertNodes.map((n) => n.ref)).toEqual([f.a]);
  });

  it("a deleted file drops its nodes and its own node, and nothing of it is upserted", async () => {
    const f = fixture();
    await f.reviewed({ "a.ts": "h1" });
    f.cache.set("h1", [extract("a.ts", "h1", [node(f.a, "file"), node(`${f.a}#s`)], [])]);
    const builder = new LivePatchBuilder({ rootId: ROOT, store: f.store, manifest: f.manifest });
    await builder.rebase();
    await f.edited("a.ts", "", "h1");
    const patch = await builder.build(["a.ts"], ["a.ts"]);
    expect(patch.removedNodes.sort()).toEqual([f.a, `${f.a}#s`].sort());
    expect(patch.upsertNodes).toEqual([]);
    expect(patch.stale).toEqual([]);
  });

  it("an unreviewed path, or an empty batch, reads nothing and moves nothing (only the changed-set rides along)", async () => {
    const f = fixture();
    await f.reviewed({ "a.ts": "h1" });
    const builder = new LivePatchBuilder({ rootId: ROOT, store: f.store, manifest: f.manifest });
    await builder.rebase();
    expect(await builder.build(["new.ts"], ["new.ts"])).toMatchObject({ files: [], upsertNodes: [], changed: ["new.ts"] });
    expect(await builder.build([], ["x.ts"])).toMatchObject({ files: [], changed: ["x.ts"] });
  });
});

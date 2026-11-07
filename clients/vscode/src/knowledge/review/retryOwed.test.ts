import { describe, expect, it } from "vitest";
import { reviewPacks } from "@builderforce/agent-tools/knowledge";
import type { ChunkFingerprint, IngestManifest } from "@seanhogg/builderforce-memory/ingest";
import { EXTRACTOR_VERSION, extractorManifestKey, filesManifestKey, planDetail, type DirectorySource } from "@seanhogg/builderforce-memory/knowledge";
import { markOwed } from "./retryOwed";

function memoryManifest(initial: Record<string, ChunkFingerprint[]> = {}): IngestManifest & { data: Map<string, ChunkFingerprint[]> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: async (id) => data.get(id),
    set: async (id, fps) => { data.set(id, fps); },
    delete: async (id) => { data.delete(id); },
  };
}

const FILES = { "src/a.ts": "export const a = 1;\n", "src/b.ts": "export const b = 2;\n" };
const source: DirectorySource = {
  rootId: "ws",
  title: "ws",
  async *list() { for (const [path, text] of Object.entries(FILES)) yield { path, hash: `hash-${path}`, size: text.length }; },
  async read(path: string) { return { id: path, tenantId: "t", content: { kind: "text", text: FILES[path as keyof typeof FILES] ?? "" } }; },
} as unknown as DirectorySource;

/** A manifest of a root fully reviewed under today's extractor: nothing is changed, nothing owed. */
const reviewedManifest = () => memoryManifest({
  [filesManifestKey("ws")]: Object.keys(FILES).map((id) => ({ id, hash: `hash-${id}` })),
  [extractorManifestKey("ws")]: [{ id: "version", hash: String(EXTRACTOR_VERSION) }],
});

const changedPaths = async (manifest: IngestManifest) => (await planDetail(source, manifest, reviewPacks({}))).files.filter((f) => f.changed).map((f) => f.path);

describe("markOwed (Retry)", () => {
  it("makes a file whose bytes did not move planned as changed again, and only that file", async () => {
    const manifest = reviewedManifest();
    expect(await changedPaths(manifest)).toEqual([]);

    expect(await markOwed(manifest, "ws", ["src/b.ts"])).toBe(1);
    expect(await changedPaths(manifest)).toEqual(["src/b.ts"]);
    const plan = await planDetail(source, manifest, reviewPacks({}));
    expect(plan.files.find((f) => f.path === "src/b.ts")).toMatchObject({ changed: true, owed: true });
    expect(plan.plan.unchanged).toBe(1);
  });

  it("keeps what the extractor entry already holds and does not add a path twice", async () => {
    const manifest = reviewedManifest();
    await markOwed(manifest, "ws", ["src/a.ts"]);
    expect(await markOwed(manifest, "ws", ["src/a.ts", "src/b.ts"])).toBe(1);
    const entry = manifest.data.get(extractorManifestKey("ws"))!;
    expect(entry.filter((f) => f.id === "version")).toHaveLength(1);
    expect(entry.map((f) => f.id).sort()).toEqual(["owed:src/a.ts", "owed:src/b.ts", "version"]);
  });

  it("is a no-op for no paths", async () => {
    const manifest = reviewedManifest();
    expect(await markOwed(manifest, "ws", [])).toBe(0);
  });
});

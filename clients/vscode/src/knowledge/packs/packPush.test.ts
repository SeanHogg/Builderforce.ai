import { describe, expect, it, vi } from "vitest";
import { srcRef, type Extracted } from "@seanhogg/builderforce-memory/knowledge";
import { decodePack, manifestTree } from "@seanhogg/builderforce-memory/knowledge/pack";
import type { PortableKnowledgePack } from "@builderforce/agent-tools/knowledge";
import { KnowledgeApiError, type KnowledgeClient } from "@builderforce/knowledge-client";
import { PACK_TRANSIENT_STREAK, PackUploadIncomplete, PackUploadUnreachable, pushPack } from "./packPush";

const ROOT = "pack:docs";
const ref = srcRef(ROOT, "a.md");
const ex: Extracted = { sourceRef: ref, sourceHash: "h1", nodes: [], edges: [], keys: [] };

const pack = {
  rootId: ROOT,
  snapshot: {
    scopes: [{ rootId: ROOT, title: "Docs", packs: [] }],
    // Two sources, each with its extracted output.
    extracted: { h1: [ex], h9: [{ ...ex, sourceRef: srcRef(ROOT, "missing.md"), sourceHash: "h9" }] },
    facts: { [ROOT]: [{ key: "claim:1", content: "c", source: "knowledge-review", importance: 0.5, origin: "model", fileAnchors: [{ path: "a.md" }] }] },
    relations: { [ROOT]: [] },
  },
} as unknown as PortableKnowledgePack;

const apiError = (status: number) => Object.assign(new Error(`knowledge API ${status}`), { status });

/** A project that holds nothing for the root: the pack goes up whole, in ONE request. */
function client(over: { sync?: () => Promise<unknown> } = {}) {
  const empty = manifestTree([]);
  const sync = vi.fn(over.sync ?? (async () => ({ applied: true, generation: 1, digest: "d" })));
  const bytesOf = vi.fn();
  const c = {
    sync: (root: string, part: { bytes: Uint8Array }) => { bytesOf(part.bytes); return sync(); },
    syncManifest: vi.fn(async () => ({ generation: 0, digest: empty.root, buckets: empty.buckets })),
    syncLeaves: vi.fn(async () => ({ generation: 0, leaves: [] })),
    syncHave: vi.fn(async (_r: string, hashes: string[]) => hashes.map(() => false)),
    putAnalysis: vi.fn(),
  } as unknown as KnowledgeClient;
  return { client: c, sync, bytesOf };
}
const live = () => new AbortController().signal;

describe("pushPack", () => {
  it("pushes the whole pack as ONE request (sources, rows, scope title) and its progress (counted in sources) reaches the total", async () => {
    const c = client();
    const progress: Array<[number, number]> = [];
    const out = await pushPack(pack, c.client, live(), (done, total) => progress.push([done, total]));
    expect(out).toEqual({ sources: 2, facts: 1, relations: 0 });
    expect(c.sync).toHaveBeenCalledTimes(1);
    const sent = await decodePack(c.bytesOf.mock.calls[0]![0] as Uint8Array);
    expect(sent.baseGeneration).toBe(0);
    expect(sent.files?.map((f) => f.path).sort()).toEqual(["a.md", "missing.md"]);
    expect(sent.extracted?.map((x) => x.hash)).toEqual(["h1", "h9"]);
    expect(sent.extracted?.[0]).toEqual({ kind: "full", hash: "h1", entries: [ex] });
    expect(sent.facts).toEqual([expect.objectContaining({ key: "claim:1" })]);
    expect(sent.scope).toMatchObject({ rootId: ROOT, title: "Docs" });
    expect(progress.at(-1)).toEqual([out!.sources, out!.sources]);
  });

  it("fails fast on a 403: the pump stops at the first refusal and nothing else is sent", async () => {
    const c = client({ sync: async () => { throw apiError(403); } });
    await expect(pushPack(pack, c.client, live(), () => undefined)).rejects.toMatchObject({ status: 403 });
    await expect(pushPack(pack, c.client, live(), () => undefined)).rejects.toBeInstanceOf(KnowledgeApiError);
  });

  it("stops after three transient failures in a row instead of waiting forever", async () => {
    // The pack is built with CompressionStream (real async I/O), so the wait is injected rather than faked with timers.
    const waits: number[] = [];
    const c = client({ sync: async () => { throw apiError(503); } });
    await expect(pushPack(pack, c.client, live(), () => undefined, async (ms) => { waits.push(ms); })).rejects.toBeInstanceOf(PackUploadUnreachable);
    expect(c.sync).toHaveBeenCalledTimes(PACK_TRANSIENT_STREAK);
    expect(waits).toEqual([1000, 2000]);
  });

  it("is never a success when the server refused the pack: it is incomplete", async () => {
    const c = client({ sync: async () => { throw apiError(422); } });
    await expect(pushPack(pack, c.client, live(), () => undefined)).rejects.toBeInstanceOf(PackUploadIncomplete);
  });

  it("returns undefined when cancelled", async () => {
    const abort = new AbortController();
    abort.abort();
    expect(await pushPack(pack, client().client, abort.signal, () => undefined)).toBeUndefined();
  });
});

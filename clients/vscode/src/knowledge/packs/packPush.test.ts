import { describe, expect, it, vi } from "vitest";
import { srcRef, type Extracted } from "@seanhogg/builderforce-memory/knowledge";
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

function client(over: { putExtracted?: () => Promise<void>; writeRows?: () => Promise<void> } = {}) {
  const store = { write: vi.fn(async () => undefined), markStale: vi.fn(async () => undefined), scopes: vi.fn(), facts: vi.fn(), relations: vi.fn() };
  const putExtracted = vi.fn(over.putExtracted ?? (async () => undefined));
  const writeRows = vi.fn(over.writeRows ?? (async () => undefined));
  return { client: { store, putExtracted, writeRows, putAnalysis: vi.fn() } as unknown as KnowledgeClient, store, putExtracted, writeRows };
}
const live = () => new AbortController().signal;

describe("pushPack", () => {
  it("pushes the sources, the rows and the scope title, and its progress (counted in sources) reaches the total", async () => {
    const c = client();
    const progress: Array<[number, number]> = [];
    const out = await pushPack(pack, c.client, live(), (done, total) => progress.push([done, total]));
    await new Promise((r) => setTimeout(r, 0));
    expect(out).toEqual({ sources: 2, facts: 1, relations: 0 });
    expect(c.putExtracted).toHaveBeenCalledWith("h1", [ex]);
    expect(c.store.markStale).toHaveBeenCalledWith({ rootId: ROOT }, ref, "h1");
    expect(c.writeRows).toHaveBeenCalledWith(ROOT, { facts: [expect.objectContaining({ key: "claim:1" })], relations: [] });
    expect(c.store.write).toHaveBeenCalledWith(expect.objectContaining({ scope: expect.objectContaining({ rootId: ROOT, title: "Docs" }) }));
    expect(progress.at(-1)).toEqual([out!.sources, out!.sources]);
  });

  it("fails fast on a 403: the pump stops at the first refusal and nothing else is sent", async () => {
    const c = client({ putExtracted: async () => { throw apiError(403); } });
    await expect(pushPack(pack, c.client, live(), () => undefined)).rejects.toMatchObject({ status: 403 });
    await expect(pushPack(pack, c.client, live(), () => undefined)).rejects.toBeInstanceOf(KnowledgeApiError);
    expect(c.writeRows).not.toHaveBeenCalled();
    expect(c.store.write).not.toHaveBeenCalled();
  });

  it("stops after three transient failures in a row instead of waiting forever", async () => {
    vi.useFakeTimers();
    try {
      const c = client({ putExtracted: async () => { throw apiError(503); } });
      const pushed = pushPack(pack, c.client, live(), () => undefined);
      const settled = expect(pushed).rejects.toBeInstanceOf(PackUploadUnreachable);
      await vi.advanceTimersByTimeAsync(10_000);
      await settled;
      expect(c.putExtracted).toHaveBeenCalledTimes(PACK_TRANSIENT_STREAK);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is never a success when a row had to be skipped: the pack is incomplete", async () => {
    const c = client({ writeRows: async () => { throw apiError(413); } });
    await expect(pushPack(pack, c.client, live(), () => undefined)).rejects.toBeInstanceOf(PackUploadIncomplete);
  });

  it("returns undefined when cancelled", async () => {
    const abort = new AbortController();
    abort.abort();
    expect(await pushPack(pack, client().client, abort.signal, () => undefined)).toBeUndefined();
  });
});

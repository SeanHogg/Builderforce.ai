import { describe, expect, it, vi } from "vitest";
import type { MemoryBackend } from "@seanhogg/builderforce-memory-mcp";
import { memoryCapabilityOver } from "./nodeMemory.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function backend(over: Partial<MemoryBackend> = {}): MemoryBackend {
  return {
    recall: vi.fn(async () => []),
    get: vi.fn(async () => undefined),
    recallByTag: vi.fn(async () => []),
    remember: vi.fn(async () => undefined),
    ...over,
  } as unknown as MemoryBackend;
}

describe("memoryCapabilityOver", () => {
  it("remembers a fact with its tags and importance", async () => {
    const store = backend();
    const result = await memoryCapabilityOver(store).remember("k", "c", { tags: ["t"], importance: 0.7 });
    expect(result).toEqual({ ok: true, key: "k" });
    expect(store.remember).toHaveBeenCalledWith({ key: "k", content: "c", tags: ["t"], importance: 0.7 });
  });

  it("turns a TTL in days into the store's milliseconds", async () => {
    const store = backend();
    await memoryCapabilityOver(store).remember("k", "c", { ttlDays: 2 });
    expect(store.remember).toHaveBeenCalledWith({ key: "k", content: "c", ttlMs: 2 * DAY_MS });
  });

  it("says so when the store is read-only, and when a write throws", async () => {
    const readOnly = backend({ remember: undefined });
    expect(await memoryCapabilityOver(readOnly).remember("k", "c")).toEqual({ ok: false, error: "this memory store is read-only" });
    const broken = backend({ remember: vi.fn(async () => Promise.reject(new Error("disk full"))) });
    expect(await memoryCapabilityOver(broken).remember("k", "c")).toEqual({ ok: false, error: "disk full" });
  });

  it("recalls the store's hits as entries, five by default", async () => {
    const store = backend({ recall: vi.fn(async () => [{ key: "a", content: "alpha" }, { key: "b", content: "beta" }]) });
    const result = await memoryCapabilityOver(store).recall("greek");
    expect(store.recall).toHaveBeenCalledWith("greek", 5);
    expect(result).toEqual({
      ok: true,
      query: "greek",
      entries: [
        { key: "a", content: "alpha", origin: "on-prem" },
        { key: "b", content: "beta", origin: "on-prem" },
      ],
    });
    await memoryCapabilityOver(store).recall("greek", 2);
    expect(store.recall).toHaveBeenLastCalledWith("greek", 2);
  });

  it("reports a failed recall instead of throwing", async () => {
    const store = backend({ recall: vi.fn(async () => Promise.reject(new Error("index locked"))) });
    expect(await memoryCapabilityOver(store).recall("q")).toEqual({ ok: false, query: "q", error: "index locked" });
  });
});

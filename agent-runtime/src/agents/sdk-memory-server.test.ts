import { describe, expect, it, vi } from "vitest";
import type { SsmMemoryService } from "../infra/ssm-memory-service.js";
import { ssmMemoryBackend } from "./sdk-memory-server.js";

/** A stand-in for the package's MemoryStoreBackend: records the raw keyed puts. */
class FakeStoreBackend {
  static puts: Array<{ key: string; content: string }> = [];
  constructor(
    readonly store: unknown,
    readonly runtime: unknown,
  ) {}
  async remember(input: { key: string; content: string }): Promise<void> {
    FakeStoreBackend.puts.push({ key: input.key, content: input.content });
  }
}

function fakeService() {
  const commitFact = vi.fn(async () => ({ verdict: "augment" }));
  const svc = { memory: { id: "store" }, runtime: { id: "runtime" }, commitFact } as unknown as SsmMemoryService;
  return { svc, commitFact };
}

const mod = { MemoryStoreBackend: FakeStoreBackend } as never;

describe("ssmMemoryBackend", () => {
  it("wraps the memory service's own store and runtime", () => {
    const { svc } = fakeService();
    const backend = ssmMemoryBackend(mod, svc) as unknown as FakeStoreBackend;
    expect(backend.store).toBe(svc.memory);
    expect(backend.runtime).toBe(svc.runtime);
  });

  it("routes a remembered fact through write-through cognition", async () => {
    const { svc, commitFact } = fakeService();
    FakeStoreBackend.puts = [];
    await ssmMemoryBackend(mod, svc).remember!({ key: "k", content: "c", tags: ["t"], importance: 0.5 });
    expect(commitFact).toHaveBeenCalledWith("k", "c", { tags: ["t"], importance: 0.5 });
    expect(FakeStoreBackend.puts).toEqual([]);
  });

  it("keeps an expiring note a raw keyed put", async () => {
    const { svc, commitFact } = fakeService();
    FakeStoreBackend.puts = [];
    await ssmMemoryBackend(mod, svc).remember!({ key: "k", content: "c", ttlMs: 1000 });
    expect(commitFact).not.toHaveBeenCalled();
    expect(FakeStoreBackend.puts).toEqual([{ key: "k", content: "c" }]);
  });
});

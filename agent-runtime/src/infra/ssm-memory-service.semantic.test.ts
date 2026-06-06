import { describe, expect, it, vi } from "vitest";
import { SsmMemoryService } from "./ssm-memory-service.js";

// getCachedOrGenerate is a thin, GPU-free delegate, so we exercise it on a
// bare instance (bypassing the private GPU-bootstrapping constructor) with a
// stub semantic cache.
function serviceWith(semanticCache: unknown): SsmMemoryService {
  const svc = Object.create(SsmMemoryService.prototype) as { semanticCache: unknown };
  svc.semanticCache = semanticCache;
  return svc as unknown as SsmMemoryService;
}

describe("SsmMemoryService.getCachedOrGenerate", () => {
  it("calls generate directly when the semantic cache is unavailable", async () => {
    const svc = serviceWith(null);
    const generate = vi.fn(async () => "fresh");
    expect(await svc.getCachedOrGenerate("q", generate)).toEqual({ response: "fresh", cached: false });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("serves a paraphrase hit from the cache without generating", async () => {
    const cache = { getOrGenerate: vi.fn(async () => ({ response: "cached", cached: true, tier: "l1" })) };
    const svc = serviceWith(cache);
    const generate = vi.fn(async () => "fresh");

    const result = await svc.getCachedOrGenerate("q", generate, { model: "m" });
    expect(result).toMatchObject({ response: "cached", cached: true });
    expect(cache.getOrGenerate).toHaveBeenCalledWith("q", generate, { model: "m" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("falls back to a direct generate when the cache throws (caching never breaks a cortex call)", async () => {
    const cache = { getOrGenerate: vi.fn(async () => { throw new Error("cache boom"); }) };
    const svc = serviceWith(cache);
    expect(await svc.getCachedOrGenerate("q", async () => "fresh")).toEqual({ response: "fresh", cached: false });
  });
});

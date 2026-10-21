import { describe, expect, it, vi } from "vitest";
import { createPersonalityBlockCache } from "./personalityBlockCache";

describe("personality block cache", () => {
  it("never caches a failed fetch — the next call asks again", async () => {
    const cache = createPersonalityBlockCache<{ userId: string }>();
    const fetchBlock = vi.fn<() => Promise<string | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("tone: warm");
    expect(await cache.get({ userId: "u1" }, fetchBlock)).toBeNull();
    expect(await cache.get({ userId: "u1" }, fetchBlock)).toBe("tone: warm");
    expect(await cache.get({ userId: "u1" }, fetchBlock)).toBe("tone: warm");
    expect(fetchBlock).toHaveBeenCalledTimes(2);
  });

  it("caches a neutral answer, and re-fetches for another persona or after clear", async () => {
    const cache = createPersonalityBlockCache<{ userId: string }>();
    const fetchBlock = vi.fn(async () => "");
    await cache.get({ userId: "u1" }, fetchBlock);
    await cache.get({ userId: "u1" }, fetchBlock);
    expect(fetchBlock).toHaveBeenCalledTimes(1);
    await cache.get({ userId: "u2" }, fetchBlock);
    expect(fetchBlock).toHaveBeenCalledTimes(2);
    cache.clear();
    await cache.get({ userId: "u2" }, fetchBlock);
    expect(fetchBlock).toHaveBeenCalledTimes(3);
  });
});

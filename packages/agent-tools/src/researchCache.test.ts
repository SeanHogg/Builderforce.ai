import { describe, expect, it } from "vitest";
import { ResearchLru, researchCacheKey } from "./researchCache.js";

const f = (path: string, mtimeMs: number, size: number) => ({ path, mtimeMs, size });

describe("researchCacheKey", () => {
  it("is the same for the same question and file state, whatever the order or spacing", () => {
    const a = researchCacheKey("how does  auth work?", [f("b.ts", 2, 20), f("a.ts", 1, 10)]);
    const b = researchCacheKey(" how does auth work? ", [f("a.ts", 1, 10), f("b.ts", 2, 20)]);
    expect(a).toBe(b);
  });

  it("moves when any file's mtime or size changes — invalidation by content, not time", () => {
    const base = researchCacheKey("q", [f("a.ts", 1, 10)]);
    expect(researchCacheKey("q", [f("a.ts", 2, 10)])).not.toBe(base);
    expect(researchCacheKey("q", [f("a.ts", 1, 11)])).not.toBe(base);
    expect(researchCacheKey("q", [f("a.ts", 1, 10), f("b.ts", 1, 1)])).not.toBe(base);
    expect(researchCacheKey("other q", [f("a.ts", 1, 10)])).not.toBe(base);
  });
});

describe("ResearchLru", () => {
  it("hits only the exact key, and a changed file misses the old answer", () => {
    const lru = new ResearchLru();
    const before = researchCacheKey("q", [f("a.ts", 1, 10)]);
    lru.set(before, "answer v1");
    expect(lru.get(before)).toBe("answer v1");
    expect(lru.get(researchCacheKey("q", [f("a.ts", 5, 10)]))).toBeUndefined();
  });

  it("drops the least recently used past its bound", () => {
    const lru = new ResearchLru(2);
    lru.set("k1", "a1");
    lru.set("k2", "a2");
    expect(lru.get("k1")).toBe("a1"); // k1 is now the most recent
    lru.set("k3", "a3");
    expect(lru.get("k2")).toBeUndefined();
    expect(lru.get("k1")).toBe("a1");
    expect(lru.get("k3")).toBe("a3");
    expect(lru.size).toBe(2);
  });

  it("round-trips through its persisted form and ignores junk", () => {
    const lru = new ResearchLru();
    lru.set("k1", "a1");
    lru.set("k2", "a2");
    const back = ResearchLru.fromJSON(JSON.parse(JSON.stringify(lru.toJSON())));
    expect(back.get("k1")).toBe("a1");
    expect(back.get("k2")).toBe("a2");
    expect(ResearchLru.fromJSON({ v: 2, entries: [["k", "a"]] }).size).toBe(0);
    expect(ResearchLru.fromJSON({ v: 1, entries: [["k"], 3, ["k2", "a2"]] }).size).toBe(1);
    expect(ResearchLru.fromJSON(null).size).toBe(0);
  });
});

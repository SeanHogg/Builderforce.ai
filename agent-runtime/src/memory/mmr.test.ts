import { describe, it, expect } from "vitest";
import {
  mmrRerank,
  applyMMRToHybridResults,
  DEFAULT_MMR_CONFIG,
  type MMRItem,
} from "./mmr.js";

describe("empty input behavior", () => {
  it("returns empty array for empty input", () => {
    expect(mmrRerank([])).toEqual([]);
    expect(applyMMRToHybridResults([])).toEqual([]);
  });
});

describe("mmrRerank", () => {
  describe("edge cases", () => {
    it("returns single item unchanged", () => {
      const items: MMRItem[] = [{ id: "1", score: 0.9, content: "hello" }];
      expect(mmrRerank(items)).toEqual(items);
    });

    it("returns copy, not original array", () => {
      const items: MMRItem[] = [{ id: "1", score: 0.9, content: "hello" }];
      const result = mmrRerank(items);
      expect(result).not.toBe(items);
    });

    it("returns items unchanged when disabled", () => {
      const items: MMRItem[] = [
        { id: "1", score: 0.9, content: "hello" },
        { id: "2", score: 0.8, content: "hello" },
      ];
      const result = mmrRerank(items, { enabled: false });
      expect(result).toEqual(items);
    });
  });

  describe("lambda edge cases", () => {
    const diverseItems: MMRItem[] = [
      { id: "1", score: 1.0, content: "apple banana cherry" },
      { id: "2", score: 0.9, content: "apple banana date" },
      { id: "3", score: 0.8, content: "elderberry fig grape" },
    ];

    it("lambda=1 returns pure relevance order", () => {
      const result = mmrRerank(diverseItems, { lambda: 1 });
      expect(result.map((i) => i.id)).toEqual(["1", "2", "3"]);
    });

    it("lambda=0 maximizes diversity", () => {
      const result = mmrRerank(diverseItems, { enabled: true, lambda: 0 });
      // First item is still highest score (no penalty yet)
      expect(result[0].id).toBe("1");
      // Second should be most different from first
      expect(result[1].id).toBe("3"); // elderberry... is most different
    });

    it("clamps lambda > 1 to 1", () => {
      const result = mmrRerank(diverseItems, { lambda: 1.5 });
      expect(result.map((i) => i.id)).toEqual(["1", "2", "3"]);
    });

    it("clamps lambda < 0 to 0", () => {
      const result = mmrRerank(diverseItems, { enabled: true, lambda: -0.5 });
      expect(result[0].id).toBe("1");
      expect(result[1].id).toBe("3");
    });
  });

  describe("diversity behavior", () => {
    it("promotes diverse results over similar high-scoring ones", () => {
      const items: MMRItem[] = [
        { id: "1", score: 1.0, content: "machine learning neural networks" },
        { id: "2", score: 0.95, content: "machine learning deep learning" },
        { id: "3", score: 0.9, content: "database systems sql queries" },
        { id: "4", score: 0.85, content: "machine learning algorithms" },
      ];

      const result = mmrRerank(items, { enabled: true, lambda: 0.5 });

      // First is always highest score
      expect(result[0].id).toBe("1");
      // Second should be the diverse database item, not another ML item
      expect(result[1].id).toBe("3");
    });

    it("handles items with identical content", () => {
      const items: MMRItem[] = [
        { id: "1", score: 1.0, content: "identical content" },
        { id: "2", score: 0.9, content: "identical content" },
        { id: "3", score: 0.8, content: "different stuff" },
      ];

      const result = mmrRerank(items, { enabled: true, lambda: 0.5 });
      expect(result[0].id).toBe("1");
      // Second should be different, not identical duplicate
      expect(result[1].id).toBe("3");
    });

    it("handles all identical content gracefully", () => {
      const items: MMRItem[] = [
        { id: "1", score: 1.0, content: "same" },
        { id: "2", score: 0.9, content: "same" },
        { id: "3", score: 0.8, content: "same" },
      ];

      const result = mmrRerank(items, { lambda: 0.7 });
      // Should still complete without error, order by score as tiebreaker
      expect(result).toHaveLength(3);
    });
  });

  describe("tie-breaking", () => {
    it("uses original score as tiebreaker", () => {
      const items: MMRItem[] = [
        { id: "1", score: 1.0, content: "unique content one" },
        { id: "2", score: 0.9, content: "unique content two" },
        { id: "3", score: 0.8, content: "unique content three" },
      ];

      // With very different content and lambda=1, should be pure score order
      const result = mmrRerank(items, { lambda: 1 });
      expect(result.map((i) => i.id)).toEqual(["1", "2", "3"]);
    });

    it("preserves all items even with same MMR scores", () => {
      const items: MMRItem[] = [
        { id: "1", score: 0.5, content: "a" },
        { id: "2", score: 0.5, content: "b" },
        { id: "3", score: 0.5, content: "c" },
      ];

      const result = mmrRerank(items, { lambda: 0.7 });
      expect(result).toHaveLength(3);
      expect(new Set(result.map((i) => i.id))).toEqual(new Set(["1", "2", "3"]));
    });
  });

  describe("score normalization", () => {
    it("handles items with same scores", () => {
      const items: MMRItem[] = [
        { id: "1", score: 0.5, content: "hello world" },
        { id: "2", score: 0.5, content: "foo bar" },
      ];

      const result = mmrRerank(items, { lambda: 0.7 });
      expect(result).toHaveLength(2);
    });

    it("handles negative scores", () => {
      const items: MMRItem[] = [
        { id: "1", score: -0.5, content: "hello world" },
        { id: "2", score: -1.0, content: "foo bar" },
      ];

      const result = mmrRerank(items, { lambda: 0.7 });
      expect(result).toHaveLength(2);
      // Higher score (less negative) should come first
      expect(result[0].id).toBe("1");
    });
  });
});

describe("applyMMRToHybridResults", () => {
  type HybridResult = {
    path: string;
    startLine: number;
    endLine: number;
    score: number;
    snippet: string;
    source: string;
  };

  it("preserves all original fields", () => {
    const results: HybridResult[] = [
      {
        path: "/test/file.ts",
        startLine: 1,
        endLine: 10,
        score: 0.9,
        snippet: "hello world",
        source: "memory",
      },
    ];

    const reranked = applyMMRToHybridResults(results);
    expect(reranked[0]).toEqual(results[0]);
  });

  it("creates unique IDs from path and startLine", () => {
    const results: HybridResult[] = [
      {
        path: "/test/a.ts",
        startLine: 1,
        endLine: 10,
        score: 0.9,
        snippet: "same content here",
        source: "memory",
      },
      {
        path: "/test/a.ts",
        startLine: 20,
        endLine: 30,
        score: 0.8,
        snippet: "same content here",
        source: "memory",
      },
    ];

    // Should work without ID collision
    const reranked = applyMMRToHybridResults(results);
    expect(reranked).toHaveLength(2);
  });

  it("re-ranks results for diversity", () => {
    const results: HybridResult[] = [
      {
        path: "/a.ts",
        startLine: 1,
        endLine: 10,
        score: 1.0,
        snippet: "function add numbers together",
        source: "memory",
      },
      {
        path: "/b.ts",
        startLine: 1,
        endLine: 10,
        score: 0.95,
        snippet: "function add values together",
        source: "memory",
      },
      {
        path: "/c.ts",
        startLine: 1,
        endLine: 10,
        score: 0.9,
        snippet: "database connection pool",
        source: "memory",
      },
    ];

    const reranked = applyMMRToHybridResults(results, { enabled: true, lambda: 0.5 });

    // First stays the same (highest score)
    expect(reranked[0].path).toBe("/a.ts");
    // Second should be the diverse one
    expect(reranked[1].path).toBe("/c.ts");
  });

  it("respects disabled config", () => {
    const results: HybridResult[] = [
      { path: "/a.ts", startLine: 1, endLine: 10, score: 0.9, snippet: "test", source: "memory" },
      { path: "/b.ts", startLine: 1, endLine: 10, score: 0.8, snippet: "test", source: "memory" },
    ];

    const reranked = applyMMRToHybridResults(results, { enabled: false });
    expect(reranked).toEqual(results);
  });
});

describe("DEFAULT_MMR_CONFIG", () => {
  it("has expected default values", () => {
    expect(DEFAULT_MMR_CONFIG.enabled).toBe(false);
    expect(DEFAULT_MMR_CONFIG.lambda).toBe(0.7);
  });
});

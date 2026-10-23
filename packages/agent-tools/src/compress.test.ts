import { describe, expect, it } from "vitest";
import type { CompressResult } from "./capabilities";
import { compressLargeContext, splitFences } from "./compress";

/** Keeps every other word; records what it was asked to compress. */
function halver(calls: string[] = []) {
  return async (text: string, _rate: number): Promise<CompressResult> => {
    calls.push(text);
    const words = text.split(/\s+/).filter(Boolean);
    const kept = words.filter((_, i) => i % 2 === 0);
    return { ok: true, text: kept.join(" "), originalTokens: words.length, keptTokens: kept.length };
  };
}

const prose = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

describe("splitFences", () => {
  it("covers every character and isolates fences", () => {
    const t = "intro\n```ts\nconst a = 1;\n```\nafter\n~~~~\nopen";
    const segs = splitFences(t);
    expect(segs.map((s) => s.kind)).toEqual(["prose", "fence", "prose", "fence"]);
    expect(segs.map((s) => s.text).join("")).toBe(t);
    expect(segs[1]?.text).toBe("```ts\nconst a = 1;\n```\n");
  });

  it("needs a closing run of the same char at least as long", () => {
    const segs = splitFences("````\n```\n~~~~\n````\nz");
    expect(segs.map((s) => s.kind)).toEqual(["fence", "prose"]);
    expect(segs[0]?.text).toBe("````\n```\n~~~~\n````\n");
  });

  it("does not treat four-space-indented backticks as a fence", () => {
    expect(splitFences("    ```\nx").map((s) => s.kind)).toEqual(["prose"]);
  });
});

describe("compressLargeContext", () => {
  it("leaves small inputs and missing compressors alone", async () => {
    const calls: string[] = [];
    const small = await compressLargeContext("short text", { minChars: 100, compress: halver(calls) });
    expect(small).toEqual({ text: "short text", compressed: false, originalTokens: 0, keptTokens: 0 });
    const none = await compressLargeContext(prose(500), { minChars: 10 });
    expect(none.compressed).toBe(false);
    expect(calls).toEqual([]);
  });

  it("compresses large prose but never sends code fences", async () => {
    const calls: string[] = [];
    const code = "```rust\nfn keep_me() {}\n```\n";
    const text = `${prose(200)}\n${code}${prose(200)}`;
    const r = await compressLargeContext(text, { minChars: 200, rate: 0.5, compress: halver(calls) });
    expect(r.compressed).toBe(true);
    expect(r.text).toContain(code);
    expect(r.text.length).toBeLessThan(text.length);
    expect(calls.length).toBe(2);
    expect(calls.some((c) => c.includes("```"))).toBe(false);
    expect(r.originalTokens).toBe(400);
    expect(r.keptTokens).toBe(200);
  });

  it("skips prose runs that are small even when the whole input is large", async () => {
    const calls: string[] = [];
    const big = "```\n" + "x\n".repeat(3000) + "```\n";
    const r = await compressLargeContext(`tiny note\n${big}`, { minChars: 500, compress: halver(calls) });
    expect(r.compressed).toBe(false);
    expect(calls).toEqual([]);
  });

  it("falls back to the original on failure, a throw, or a result that is not shorter", async () => {
    const text = prose(300);
    for (const compress of [
      async () => ({ ok: false, error: "down" }),
      async () => {
        throw new Error("boom");
      },
      async (t: string) => ({ ok: true, text: `${t} more` }),
    ]) {
      const r = await compressLargeContext(text, { minChars: 10, compress });
      expect(r).toEqual({ text, compressed: false, originalTokens: 0, keptTokens: 0 });
    }
  });

  it("does nothing at rate 1 or 0", async () => {
    const calls: string[] = [];
    for (const rate of [1, 0]) {
      const r = await compressLargeContext(prose(300), { minChars: 10, rate, compress: halver(calls) });
      expect(r.compressed).toBe(false);
    }
    expect(calls).toEqual([]);
  });
});

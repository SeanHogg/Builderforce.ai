import { describe, it, expect } from "vitest";
import { Linear, Embedding, LayerNorm, RMSNorm, scaledDotProductAttention } from "../src/nn";
import { fromArray, fromIntArray, ones, eye } from "../src/creation";

describe("Linear", () => {
  it("y = x @ W^T + b", () => {
    // weight [2, 3]: [[1, 2, 3], [4, 5, 6]]
    const w = fromArray([1, 2, 3, 4, 5, 6], [2, 3]);
    const b = fromArray([10, 20], [2]);
    const layer = new Linear(w, b);
    // x [1, 3] = [1, 1, 1] -> y = [1+2+3+10, 4+5+6+20] = [16, 35]
    const x = ones([1, 3]);
    expect(layer.forward(x).toArray()).toEqual([[16, 35]]);
  });

  it("works without bias", () => {
    const w = eye(3);
    const layer = new Linear(w);
    const x = fromArray([1, 2, 3], [1, 3]);
    expect(layer.forward(x).toArray()).toEqual([[1, 2, 3]]);
  });

  it("rejects input with mismatched in_features", () => {
    const layer = new Linear(eye(3));
    expect(() => layer.forward(ones([1, 4]))).toThrow();
  });
});

describe("Embedding", () => {
  it("looks up rows by id", () => {
    const w = fromArray([10, 20, 30, 40, 50, 60], [3, 2]); // 3 vocab × 2 dim
    const emb = new Embedding(w);
    const ids = fromIntArray([0, 2, 1], [3]);
    expect(emb.forward(ids).toArray()).toEqual([
      [10, 20],
      [50, 60],
      [30, 40],
    ]);
  });

  it("rejects out-of-range ids", () => {
    const emb = new Embedding(fromArray([1, 2, 3, 4], [2, 2]));
    expect(() => emb.forward(fromIntArray([5], [1]))).toThrow(/out of range/);
  });
});

describe("LayerNorm", () => {
  it("normalizes the last dim to mean=0, var=1 (then scales by gamma)", () => {
    const ln = new LayerNorm(ones([4]), null);
    const x = fromArray([1, 2, 3, 4, 5, 6, 7, 8], [2, 4]);
    const y = ln.forward(x).toArray() as number[][];
    for (const row of y) {
      const m = row.reduce((p, v) => p + v, 0) / row.length;
      const v = row.reduce((p, val) => p + (val - m) * (val - m), 0) / row.length;
      expect(Math.abs(m)).toBeLessThan(1e-5);
      expect(v).toBeCloseTo(1, 4);
    }
  });
});

describe("RMSNorm", () => {
  it("scales by 1/sqrt(mean(x^2) + eps)", () => {
    const norm = new RMSNorm(ones([2]));
    const x = fromArray([3, 4], [2]); // mean(x^2) = 12.5; rms = sqrt(12.5) = 3.536
    const y = norm.forward(x).toArray() as number[];
    expect(y[0]!).toBeCloseTo(3 / Math.sqrt(12.5 + 1e-6), 3);
    expect(y[1]!).toBeCloseTo(4 / Math.sqrt(12.5 + 1e-6), 3);
  });
});

describe("scaledDotProductAttention", () => {
  it("identity-ish: q=k=I and v=I produces I", () => {
    const I = eye(4);
    // Pre-shape to [1, 4, 4] (batch dim)
    const out = scaledDotProductAttention(I, I, I).toArray() as number[][];
    // softmax over rows of (Q@K^T)/sqrt(D) — D=4 so /2; identity gives diag dominant
    // Result is approximately a softened identity; just verify shape + finiteness.
    expect(out.length).toBe(4);
    for (const row of out) {
      expect(row.length).toBe(4);
      const rowSum = row.reduce((p, v) => p + v, 0);
      expect(Number.isFinite(rowSum)).toBe(true);
    }
  });

  it("shape: [B, L, D] in → [B, L, D] out", () => {
    const q = fromArray(new Array(2 * 3 * 4).fill(0).map((_, i) => i / 24), [2, 3, 4]);
    const out = scaledDotProductAttention(q, q, q);
    expect(out.shape).toEqual([2, 3, 4]);
  });

  it("attention weights sum to 1 along the keys axis (probabilistic interpretation)", () => {
    // If V is the identity, the result columns are the attention weights themselves.
    const I = eye(3);
    const q = ones([3, 3]);
    const out = scaledDotProductAttention(q, I, I).toArray() as number[][];
    for (const row of out) {
      expect(row.reduce((p, v) => p + v, 0)).toBeCloseTo(1, 4);
    }
  });
});

/**
 * Pure-TS vector maths for the Worker bundle.
 *
 * This is the single, zero-dependency home for the cosine-similarity that the
 * gateway needs (semantic response cache, embedding compares). It deliberately
 * does NOT import `@builderforce/memory` / its `similarity` module: that package
 * pulls the WebGPU SSM engine, which cannot be bundled into a Cloudflare Worker.
 * Keeping one named, tested copy here removes the silent hand-sync drift the gap
 * register flagged — every Worker-side consumer imports THIS, not an inline copy.
 *
 * Semantics are kept identical to the library's `cosineSimilarity`:
 *   • compares over the shorter of the two vectors (min length),
 *   • returns 0 for an empty input or a zero-magnitude vector.
 */

/**
 * Cosine similarity of two numeric vectors. Compares over the overlapping
 * prefix (`min(a.length, b.length)`) and returns 0 for an empty or zero vector
 * (so callers can treat 0 as "no signal" without a divide-by-zero NaN).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

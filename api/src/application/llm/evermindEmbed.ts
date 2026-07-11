/**
 * SSM-embedding recall primitives for the project Evermind.
 *
 * The runtime's real semantic recall keys off the model's own hidden state (see
 * builderforce-memory `MambaSession.embed` — mean-pool the final hidden state, then
 * L2-normalise so cosine reduces to a dot product). The project Evermind is an
 * `evermind-lm`, whose `EvermindLM.forward()` already exposes that final hidden state
 * as `cache.finalX` — so we can produce the SAME kind of embedding here without any
 * engine change: run the model, mean-pool `finalX`, L2-normalise.
 *
 * Embeddings are computed ONCE per memory at merge time (stored on the coordinator's
 * recent ring) and once per query at recall time, so a recall is a single forward
 * plus a cheap cosine scan — never a per-request re-embed of the whole ring.
 */
import type { EvermindLM } from '@seanhogg/builderforce-memory-engine';

/** Max tokens fed to one embedding pass — bounds the forward cost per memory / query. */
export const EMBED_MAX_TOKENS = 96;

/**
 * A fixed-length (`dModel`) L2-normalised semantic embedding of `tokens`, derived
 * from the model's final hidden state (mean-pooled over positions). Mirrors the
 * runtime's `MambaSession.embed`, so vectors from here are directly comparable by
 * cosine. Returns a zero vector for empty input.
 */
export function embedTokens(lm: EvermindLM, tokens: number[]): Float32Array {
  const dModel = lm.config.dModel;
  const out = new Float32Array(dModel);
  if (tokens.length === 0) return out;
  const ids = tokens.length > EMBED_MAX_TOKENS ? tokens.slice(0, EMBED_MAX_TOKENS) : tokens;
  const { cache } = lm.forward(ids);
  const x = cache.finalX;
  if (x.length === 0) return out;
  for (const row of x) {
    for (let d = 0; d < dModel; d++) out[d] += row[d]!;
  }
  const inv = 1 / x.length;
  for (let d = 0; d < dModel; d++) out[d] *= inv;
  let norm = 0;
  for (let d = 0; d < dModel; d++) norm += out[d] * out[d];
  norm = Math.sqrt(norm) || 1;
  for (let d = 0; d < dModel; d++) out[d] /= norm;
  return out;
}

/** Cosine similarity of two (L2-normalised) vectors = clamped dot product, [-1, 1]. */
export function cosineVec(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i]! * b[i]!;
  return dot < -1 ? -1 : dot > 1 ? 1 : dot;
}

/** Pack a Float32 embedding to base64 (little-endian bytes) for compact DO storage. */
export function packVec(v: Float32Array): string {
  const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  let s = '';
  // Chunk to avoid a huge apply() arg list; dModel is small so a simple loop is fine.
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

/** Inverse of {@link packVec}: base64 → Float32 embedding. Returns [] on malformed input. */
export function unpackVec(b64: string): Float32Array {
  try {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    // A truncated payload (length not a multiple of 4) can't be a Float32 view.
    if (u.byteLength % 4 !== 0) return new Float32Array(0);
    return new Float32Array(u.buffer);
  } catch {
    return new Float32Array(0);
  }
}

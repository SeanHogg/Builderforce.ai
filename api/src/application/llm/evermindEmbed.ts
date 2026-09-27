/**
 * Recall embeddings for the project Evermind — the gateway's storage policy around the
 * engine's own `EvermindLM.embed` (mean-pooled, L2-normalised final hidden state).
 *
 * Embeddings are computed ONCE per memory at merge time (stored on the coordinator's
 * recent ring, packed) and once per query at recall time, so a recall is a single
 * forward plus a cheap cosine scan — never a per-request re-embed of the whole ring.
 */
import { base64ToBytes, bytesToBase64, type EvermindLM } from '@seanhogg/builderforce-memory-engine';

/** Max tokens fed to one embedding pass — bounds the forward cost per memory / query. */
export const EMBED_MAX_TOKENS = 96;

/** The tokenizer surface an embedding needs (the engine's `BPETokenizer` satisfies it). */
interface EmbedTokenizer {
  encode(text: string): number[];
}

/** Embed `text` for recall: tokenize, cap at {@link EMBED_MAX_TOKENS}, run the engine embed. */
export function embedForRecall(lm: EvermindLM, tok: EmbedTokenizer, text: string): Float32Array {
  return lm.embed(tok.encode(text).slice(0, EMBED_MAX_TOKENS));
}

/** Pack a Float32 embedding to base64 (little-endian bytes) for compact DO storage. */
export function packVec(v: Float32Array): string {
  return bytesToBase64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
}

/** Inverse of {@link packVec}: base64 → Float32 embedding. Returns [] on malformed input. */
export function unpackVec(b64: string): Float32Array {
  try {
    const bytes = base64ToBytes(b64);
    // A truncated payload (length not a multiple of 4) can't be a Float32 view.
    return bytes.byteLength % 4 === 0 ? new Float32Array(bytes) : new Float32Array(0);
  } catch {
    return new Float32Array(0);
  }
}

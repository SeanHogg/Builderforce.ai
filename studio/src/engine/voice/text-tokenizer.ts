/**
 * text-tokenizer (Phase 2) — text ▶ acoustic-model input tokens + word spans.
 *
 * A character-level tokenizer (the same grapheme-level granularity the host
 * frontend's mamba-engine uses for its character embeddings). Real TTS front-ends
 * run a grapheme-to-phoneme step here; a phonemizer drops in behind
 * `tokenizeText` without changing the acoustic model, and is tracked as a Gap
 * Register follow-up. Alongside the token ids we emit word boundaries so the
 * engine can turn predicted frame counts into `wordTimestamps` for captions.
 */

/** Stable vocabulary: a-z, 0-9, space, and a handful of prosodic punctuation.
 *  Index 0 is reserved as the padding / unknown token. */
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789 .,!?'-";
const CHAR_TO_ID = new Map<string, number>();
for (let i = 0; i < ALPHABET.length; i++) CHAR_TO_ID.set(ALPHABET[i], i + 1);

/** Vocabulary size including the reserved 0 token. */
export const TEXT_VOCAB_SIZE = ALPHABET.length + 1;

export interface TokenizedText {
  /** Per-character token ids (unknown chars → 0). */
  tokens: number[];
  /** Words in order, each with its [startChar, endChar) span over `tokens`. */
  words: { word: string; startChar: number; endChar: number }[];
}

/** Normalise + tokenize. Collapses whitespace runs to single spaces so timing
 *  isn't thrown off by formatting. */
export function tokenizeText(text: string): TokenizedText {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const tokens: number[] = [];
  for (const ch of normalized) tokens.push(CHAR_TO_ID.get(ch) ?? 0);

  const words: { word: string; startChar: number; endChar: number }[] = [];
  let cursor = 0;
  for (const word of normalized.split(' ')) {
    if (word.length === 0) continue;
    const startChar = normalized.indexOf(word, cursor);
    const endChar = startChar + word.length;
    words.push({ word, startChar, endChar });
    cursor = endChar;
  }

  return { tokens, words };
}

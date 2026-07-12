/**
 * textCoherence — pure, zero-dependency text-quality primitives shared by every
 * surface that must decide whether text a project's OWN SSM (Evermind) produced is
 * fit to show a user. Kept dependency-free (no db/env/engine imports) so it can be
 * imported by BOTH the memory-first resolver (`projectMemory`) and the model probe
 * (`evermindRuntime`) without an import cycle.
 */

/** A reply shorter than this isn't a real answer — fall through to the LLM. Mirrors
 *  the cloud/BrainService threshold so every surface adopts Evermind identically. */
export const EVERMIND_ANSWER_MIN_CHARS = 20;

/**
 * Cheap coherence gate for text a project's OWN SSM (Evermind) produced. An
 * under-trained head emits fluent-LOOKING garbage — broken UTF-8 (Unicode
 * replacement chars from byte-level BPE), stray single letters, and degenerate
 * word repetition ("commit … commit … commit", "in the in the") — that trivially
 * clears a length check. Serving it makes the assistant reply in gibberish, so
 * this gate rejects it and the caller falls through to a real LLM (a garbled reply
 * IS a memory miss). Zero-dep, structural (no dictionary), and language-agnostic —
 * the checks key on repetition/decode signatures, not on English words, so they
 * don't mis-judge legitimate non-English replies (es "y"/"o", fr "à", CJK).
 */
export function looksLikeCoherentText(text: string): boolean {
  const t = (text ?? '').trim();
  if (!t) return false;

  // 1) Broken token decoding. A byte-level BPE emitting a low-probability token
  //    sequence frequently yields invalid UTF-8 → the replacement char. Real
  //    answers effectively never contain it → near-certain garbage.
  if (t.includes('�')) return false;

  const words = t.toLowerCase().match(/\p{L}+/gu) ?? [];
  // Too few alphabetic tokens to score structurally (CJK collapses to one run); it
  // already cleared the length + replacement-char gates, so accept (a handful of
  // clean words is a real answer).
  if (words.length < 6) return true;

  // 2) Adjacent runaway repetition: a stuck decoder repeats a token ("commit
  //    commit") or a bigram ("in the in the"). A little is normal prose.
  let rep = 0;
  for (let i = 1; i < words.length; i++) if (words[i] === words[i - 1]) rep++;
  for (let i = 3; i < words.length; i++) {
    if (words[i] === words[i - 2] && words[i - 1] === words[i - 3]) rep++;
  }
  if (rep >= 3 && rep / words.length > 0.06) return false;

  // 3) Dominant-token collapse: an under-trained head that overfit its corpus
  //    fixates on ONE content word and sprays it ("commit … commit … commit",
  //    ~15× in the observed sample). Count per token (length ≥ 3 so function words
  //    "the"/"in"/"a" can't trip it); if one word is both frequent in absolute
  //    terms AND a large share of the reply, it's degenerate. The dual gate (≥5
  //    occurrences AND >15%) spares a legitimately commit-heavy answer — that
  //    stays either below the count floor (short) or below the share (long).
  const freq = new Map<string, number>();
  for (const w of words) if (w.length >= 3) freq.set(w, (freq.get(w) ?? 0) + 1);
  let maxCount = 0;
  for (const c of freq.values()) if (c > maxCount) maxCount = c;
  if (maxCount >= 5 && maxCount / words.length > 0.15) return false;

  return true;
}

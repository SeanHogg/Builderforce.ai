/**
 * textCoherence — pure, zero-dependency text-quality primitives shared by every
 * surface that must decide whether text a project's OWN SSM (Evermind) produced is
 * fit to show a user. Kept dependency-free (no db/env/engine imports) so it can be
 * imported by BOTH the memory-first resolver (`projectMemory`), the model probe
 * (`evermindRuntime`) and the gateway vendor without an import cycle.
 */

import {
  detectLatinLanguage,
  isCodeishToken,
  scoreEnglishWordiness,
} from './wordLexicon';

/** A reply shorter than this isn't a real answer — fall through to the LLM. Mirrors
 *  the cloud/BrainService threshold so every surface adopts Evermind identically. */
export const EVERMIND_ANSWER_MIN_CHARS = 20;

/** Why the gate rejected a text. Surfaced to operators (console test bench, quarantine
 *  reason, vendor error) so "it produced gibberish" is never an unexplained verdict. */
export type CoherenceFailure =
  | 'empty'
  | 'replacement-chars'
  | 'repetition'
  | 'dominant-token'
  | 'unbalanced-delimiters'
  | 'no-function-words'
  | 'non-words';

/** The gate's verdict + the specific signal that produced it. */
export interface CoherenceVerdict {
  coherent: boolean;
  /** The failing signal, or null when the text passed. */
  failure: CoherenceFailure | null;
  /** Short operator-facing explanation of {@link failure} (empty when coherent). */
  detail: string;
}

export interface CoherenceOptions {
  /**
   * The prompt/question the text answers, when the caller has it. Domain jargon
   * ("Evermind", "neocortex", a repo name) reliably echoes the ask, so treating
   * context words as known is what keeps the non-word check from mis-accusing a
   * legitimate, jargon-dense answer. Optional — the gate works without it.
   */
  context?: string;
}

/** Human-readable explanations, one per failure signal. */
const FAILURE_DETAIL: Record<CoherenceFailure, string> = {
  'empty': 'the model returned nothing',
  'replacement-chars': 'the output contains Unicode replacement characters (broken token decoding)',
  'repetition': 'the decoder is stuck repeating the same word or phrase',
  'dominant-token': 'one word dominates the output — the head has collapsed onto a single token',
  'unbalanced-delimiters': 'the output closes brackets it never opened',
  'no-function-words': 'the output has no recognisable function words in any supported language',
  'non-words': 'most of the content words are not real words — the head is emitting invented tokens',
};

/**
 * Cheap coherence gate for text a project's OWN SSM (Evermind) produced. An
 * under-trained head emits fluent-LOOKING garbage — broken UTF-8 (Unicode
 * replacement chars from byte-level BPE), degenerate word repetition ("commit …
 * commit … commit", "in the in the"), and fluent-shaped prose made entirely of
 * INVENTED words — that trivially clears a length check. Serving it makes the
 * assistant reply in gibberish, so this gate rejects it and the caller falls through
 * to a real LLM (a garbled reply IS a memory miss).
 *
 * Signals 1–4 are structural and language-agnostic. Signals 5–6 consult a lexicon and
 * are therefore GUARDED: they run only on predominantly-Latin, non-code text, and the
 * dictionary check only when the text is confidently English — so an es/fr/de/pt/it
 * reply, a CJK reply, or a code block is never judged by an English word list.
 */
export function assessTextCoherence(text: string, opts: CoherenceOptions = {}): CoherenceVerdict {
  const t = (text ?? '').trim();
  if (!t) return fail('empty');

  // 1) Broken token decoding. A byte-level BPE emitting a low-probability token
  //    sequence frequently yields invalid UTF-8 → the replacement char. Real
  //    answers effectively never contain it → near-certain garbage.
  if (t.includes('�')) return fail('replacement-chars');

  const words = t.toLowerCase().match(/\p{L}+/gu) ?? [];
  // Too few alphabetic tokens to score structurally (CJK collapses to one run); it
  // already cleared the length + replacement-char gates, so accept (a handful of
  // clean words is a real answer).
  if (words.length < 6) return pass();

  // 2) Adjacent runaway repetition: a stuck decoder repeats a token ("commit
  //    commit") or a bigram ("in the in the"). A little is normal prose.
  let rep = 0;
  for (let i = 1; i < words.length; i++) if (words[i] === words[i - 1]) rep++;
  for (let i = 3; i < words.length; i++) {
    if (words[i] === words[i - 2] && words[i - 1] === words[i - 3]) rep++;
  }
  if (rep >= 3 && rep / words.length > 0.06) return fail('repetition');

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
  if (maxCount >= 5 && maxCount / words.length > 0.15) return fail('dominant-token');

  // 4) Orphaned closing delimiters. The checks above key on REPETITION, so they miss
  //    the other failure mode of an under-trained byte-BPE head: fluent-shaped text made
  //    of invented words, each different. What that text does emit is punctuation it
  //    never opened — it learned that `)` and `.` follow tokens, not that a bracket has
  //    to be opened first. Structural, language-agnostic, and cheap: real prose and real
  //    code balance their delimiters. The floor of TWO spares a legitimate stray paren.
  if (unmatchedClosers(t) >= 2) return fail('unbalanced-delimiters');

  return assessVocabulary(t, words, opts);
}

/**
 * Signals 5–6 — the LEXICAL half of the gate, split out so the guards that make it
 * safe live in one readable place. This is what closes the gap the structural checks
 * cannot see: invented words with balanced punctuation and no repetition.
 *
 * It is skipped entirely unless the text is predominantly Latin-script and mostly
 * prose (not code), because outside that envelope a word list proves nothing.
 */
function assessVocabulary(t: string, words: string[], opts: CoherenceOptions): CoherenceVerdict {
  // Raw whitespace tokens paired with their alphabetic core, so the scorer can tell an
  // identifier (`projectEvermindRef`, `api/src/x.ts`, `v2.1`) from a prose word.
  const rawTokens: string[] = [];
  const coreWords: string[] = [];
  for (const raw of t.split(/\s+/u)) {
    const core = raw
      .replace(/^[^\p{L}]+/u, '')
      .replace(/[^\p{L}]+$/u, '')
      .toLowerCase()
      .replace(/[''’-]/gu, '');
    if (!core || !/^\p{L}+$/u.test(core)) { rawTokens.push(raw); coreWords.push(''); continue; }
    rawTokens.push(raw);
    coreWords.push(core);
  }
  // Code-dominant text (a diff, a config dump, a stack trace) is legitimately made of
  // non-words — never judge it lexically.
  const codeish = rawTokens.filter((r) => r && isCodeishToken(r)).length;
  if (rawTokens.length > 0 && codeish / rawTokens.length > 0.3) return pass();

  const lang = detectLatinLanguage(words, t);
  if (!lang.latin) return pass(); // CJK / Cyrillic / Arabic — out of scope by design.

  // 5) No function words at all. Prose in EVERY supported language is ≥ ~10% function
  //    words; a long Latin-script, non-code passage with essentially none is not a
  //    language. This is the check that catches gibberish too degenerate to even
  //    identify a language for — the case the dictionary check below can't reach.
  if (words.length >= 25 && lang.anyShare < 0.04) return fail('no-function-words');

  // 6) Invented-word share. English-only, and only when English UNAMBIGUOUSLY won the
  //    function-word vote — a Spanish/French/German/Portuguese/Italian reply is never
  //    measured against an English lexicon. The scorer additionally forgives any token
  //    that echoes the prompt or recurs in the text, so jargon-dense real answers pass
  //    while each-word-different gibberish does not.
  if (lang.language !== 'en') return pass();
  const score = scoreEnglishWordiness(coreWords.filter(Boolean), rawTokens.filter((_, i) => !!coreWords[i]), opts.context);
  if (score.scored && score.unknown >= 5 && score.unknownShare >= 0.5) {
    return {
      coherent: false,
      failure: 'non-words',
      detail: `${FAILURE_DETAIL['non-words']} (${score.unknown}/${score.eligible} unrecognised)`,
    };
  }

  return pass();
}

const pass = (): CoherenceVerdict => ({ coherent: true, failure: null, detail: '' });
const fail = (failure: CoherenceFailure): CoherenceVerdict => ({ coherent: false, failure, detail: FAILURE_DETAIL[failure] });

/**
 * Boolean form of {@link assessTextCoherence} — the shape every existing caller uses.
 * Prefer the assessment when you have somewhere to SHOW the reason.
 */
export function looksLikeCoherentText(text: string, opts: CoherenceOptions = {}): boolean {
  return assessTextCoherence(text, opts).coherent;
}

/** Is this text both substantive (long enough) AND coherent — the ONE bar every serve
 *  path applies before showing SSM output to a user. Shared so the length threshold and
 *  the gate can never drift apart between the memory resolver, the vendor and the probe. */
export function isServableText(text: string | null | undefined, opts: CoherenceOptions = {}): CoherenceVerdict {
  const t = (text ?? '').trim();
  if (t.length < EVERMIND_ANSWER_MIN_CHARS) {
    return { coherent: false, failure: 'empty', detail: `the model returned less than ${EVERMIND_ANSWER_MIN_CHARS} characters` };
  }
  return assessTextCoherence(t, opts);
}

/** How many closing brackets appear with no opener before them. Pure counting — a
 *  balanced or over-opened text scores 0. Shared by {@link assessTextCoherence}. */
function unmatchedClosers(text: string): number {
  let depth = 0;
  let orphans = 0;
  for (const ch of text) {
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth > 0) depth--;
      else orphans++;
    }
  }
  return orphans;
}

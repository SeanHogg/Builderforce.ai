/**
 * predict/ngram.ts — the project-local code language model behind naturalness (PRD 41 §D6; Hindle et al., ICSE 2012):
 * a token trigram with interpolated absolute discounting, trained on the repository's own unchanged lines.
 *
 * Lines are lexed from the file's `bare` mask (agent-tools `maskSource`: comments and strings blanked, line breaks kept), so
 * a comment or a message string never makes code look unusual, and a block comment's inner lines carry no tokens. Each line
 * is its own sentence: `<s> <s> t₁ … tₙ </s>`.
 *
 *   P(w | u v) = max(c(uvw) − D, 0) / c(uv·) + D · N₁₊(uv·) / c(uv·) · P(w | v)     (c(uv·) = 0 ⇒ P(w | v))
 *   P(w | v)   = the same over bigrams, down to
 *   P(w)       = max(c(w) − D, 0) / N + D · V / N · 1 / (V + 1)                    (V + 1: one slot for an unseen token)
 *
 * Pure and deterministic: counts only, no randomness; surprisals are quantized by the caller.
 */

import { codeLanguageOf, maskSource } from '@builderforce/agent-tools/code-mask';

/** Absolute discount (the classic 0.75). */
export const NGRAM_DISCOUNT = 0.75;

const BOS = '\u0002';
const EOS = '\u0003';
const SEP = '\u0000';
/** An identifier, a number, or one punctuation character. */
const TOKEN = /[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|[^\s\w]/g;

/** Per line (index = line − 1), the code tokens of a file's text with its comments and strings masked out. */
export function codeLineTokens(path: string, text: string): string[][] {
    const bare = maskSource(text, codeLanguageOf(path)).bare;
    return bare.split(/\r?\n/).map((line) => line.match(TOKEN) ?? []);
}

/** A trained trigram: log₂ P of each token of a line given the two before it. */
export interface TrigramModel {
    /** Distinct tokens seen in training (without the sentence markers' start). */
    readonly vocabulary: number;
    /** Tokens seen in training, end markers included. */
    readonly tokens: number;
    /** The distinct tokens seen in training, sorted (the end marker included): with one unseen slot, the V + 1 outcomes. */
    readonly seen: readonly string[];
    /** P(w | u v); `u`/`v` undefined = the line start. */
    probability(u: string | undefined, v: string | undefined, w: string): number;
    /** Mean −log₂ P over the line's tokens and its end marker (bits per token). Undefined for an empty line. */
    surprisal(tokens: readonly string[]): number | undefined;
}

/** The end-of-line marker as {@link TrigramModel.seen} lists it. */
export const END_OF_LINE = EOS;

interface Counts {
    /** n-gram → count. */
    gram: Map<string, number>;
    /** context → total count of what followed it. */
    total: Map<string, number>;
    /** context → distinct followers. */
    types: Map<string, number>;
}

const newCounts = (): Counts => ({ gram: new Map(), total: new Map(), types: new Map() });

function add(counts: Counts, context: string, word: string): void {
    const key = context + SEP + word;
    const seen = counts.gram.get(key) ?? 0;
    counts.gram.set(key, seen + 1);
    counts.total.set(context, (counts.total.get(context) ?? 0) + 1);
    if (seen === 0) counts.types.set(context, (counts.types.get(context) ?? 0) + 1);
}

/** The interpolated estimate at one order over the lower order's `lower`. */
function interpolate(counts: Counts, context: string, word: string, lower: number): number {
    const total = counts.total.get(context) ?? 0;
    if (total === 0) return lower;
    const c = counts.gram.get(context + SEP + word) ?? 0;
    const types = counts.types.get(context) ?? 0;
    return Math.max(c - NGRAM_DISCOUNT, 0) / total + (NGRAM_DISCOUNT * types / total) * lower;
}

/** Trains the trigram on tokenized lines (empty lines are skipped). */
export function trainTrigram(lines: Iterable<readonly string[]>): TrigramModel {
    const unigram = new Map<string, number>();
    const bigram = newCounts();
    const trigram = newCounts();
    let n = 0;
    for (const line of lines) {
        if (line.length === 0) continue;
        const seq = [BOS, BOS, ...line, EOS];
        for (let i = 2; i < seq.length; i++) {
            const w = seq[i]!;
            unigram.set(w, (unigram.get(w) ?? 0) + 1);
            add(bigram, seq[i - 1]!, w);
            add(trigram, seq[i - 2]! + SEP + seq[i - 1]!, w);
            n++;
        }
    }
    const vocabulary = unigram.size;
    const uniform = 1 / (vocabulary + 1);
    const pUnigram = (w: string): number =>
        n === 0 ? uniform : Math.max((unigram.get(w) ?? 0) - NGRAM_DISCOUNT, 0) / n + (NGRAM_DISCOUNT * vocabulary / n) * uniform;
    const probability = (u: string | undefined, v: string | undefined, w: string): number => {
        const p2 = interpolate(bigram, v ?? BOS, w, pUnigram(w));
        return interpolate(trigram, (u ?? BOS) + SEP + (v ?? BOS), w, p2);
    };
    return {
        vocabulary,
        tokens: n,
        seen: [...unigram.keys()].sort(),
        probability,
        surprisal(tokens) {
            if (tokens.length === 0) return undefined;
            const seq = [BOS, BOS, ...tokens, EOS];
            let bits = 0;
            for (let i = 2; i < seq.length; i++) bits -= Math.log2(probability(seq[i - 2], seq[i - 1], seq[i]!));
            return bits / (seq.length - 2);
        },
    };
}

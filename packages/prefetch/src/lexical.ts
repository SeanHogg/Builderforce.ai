/**
 * Tier 2's lexical half: how close a request is to an action's `examples`, as a small
 * fixed feature vector the per-action logistic head (`calibrate.ts`) scores.
 *
 * Deliberately tiny and local — the shared tokenizers in `packages/` belong to other
 * domains (`repo-map` query terms, the resume lexicon) and importing either would make
 * this pure gate depend on them. Pure and deterministic.
 */

/** Words that carry no intent: a request and an example sharing only these share nothing. */
const STOP = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'be', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'it', 'its', 'this', 'that',
  'these', 'those', 'me', 'my', 'we', 'our', 'you', 'your', 'i', 'can', 'could', 'would', 'should', 'please', 'do',
  'does', 'with', 'at', 'by', 'from', 'as', 'so', 'just', 'some', 'any', 'there', 'here', 'what', 'how', 'hey', 'ok',
]);

/** The feature vector's width — the head's weight count. */
export const LEXICAL_FEATURES = 3;

/** Lower-cased content words, camelCase and snake_case split, a plural `s` folded. */
export function tokenize(text: string): string[] {
  const words = (text ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  const out: string[] = [];
  for (const raw of words) {
    if (raw.length < 2 || STOP.has(raw)) continue;
    const word = raw.length > 3 && raw.endsWith('s') && !raw.endsWith('ss') ? raw.slice(0, -1) : raw;
    if (!out.includes(word)) out.push(word);
  }
  return out;
}

/** Set cosine of two token lists, 0..1. */
export function similarity(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const set = new Set(b);
  let shared = 0;
  for (const t of a) if (set.has(t)) shared += 1;
  return shared / Math.sqrt(a.length * b.length);
}

/**
 * `[best similarity, mean of the best two, share of the request's words any example
 * uses]` — the head's input. Zeros when the request or the examples say nothing.
 */
export function lexicalFeatures(request: readonly string[], examples: ReadonlyArray<readonly string[]>): number[] {
  if (request.length === 0 || examples.length === 0) return [0, 0, 0];
  const sims = examples.map((ex) => similarity(request, ex)).sort((x, y) => y - x);
  const best = sims[0] ?? 0;
  const top2 = sims.length > 1 ? (best + sims[1]!) / 2 : best;
  const vocab = new Set(examples.flat());
  const covered = request.filter((t) => vocab.has(t)).length / request.length;
  return [best, top2, covered];
}

/** Two requests this close are the same ask. */
export const REASK_SIMILARITY = 0.6;

/**
 * "Accepted" is the absence of a re-ask: the person's NEXT request in the same chat
 * asking the same thing again means the deterministic answer (or the prefetched facts)
 * did not settle it. The simplest faithful signal — no model, no UI.
 */
export function isReask(previous: string, next: string): boolean {
  return similarity(tokenize(previous), tokenize(next)) >= REASK_SIMILARITY;
}

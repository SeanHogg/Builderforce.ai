/**
 * "Is this the SAME piece of work under a different sentence?" — the near-duplicate
 * title test behind every idempotent `*.create` on the board.
 *
 * The create tools used to dedup on an EXACT normalized title (whitespace-collapsed,
 * lowercased). That holds for a literal retry of the identical call and for nothing
 * else, and a model does not retry literally: asked twice to record the same gap it
 * writes "Fix login redirect loop", then "Login redirect loop needs fixing", and the
 * board grows a second ticket for one piece of work. That is the reported failure —
 * a Brain run that "duplicated the analysis twice and didn't fix" the tickets.
 *
 * THE ASYMMETRY THAT SETS THE THRESHOLD. The two errors are not equally bad. A missed
 * duplicate costs a redundant row somebody can merge. A FALSE duplicate silently
 * returns a DIFFERENT ticket to the caller — the requested work is never recorded, and
 * nothing anywhere says so. So this is deliberately strict, and every rule below is
 * shaped to keep near-miss pairs that share most of their words APART:
 *
 *   "Fix login redirect loop"  vs  "Fix signup redirect loop"    → NOT duplicates
 *   "Fix login redirect loop"  vs  "Login redirect loop needs fixing" → duplicates
 *
 * Both share three of four content words; what separates them is that the first pair
 * disagrees on a word neither contains (`login` / `signup`) while the second pair
 * disagrees only by adding filler. Jaccard over stemmed content tokens sees exactly
 * that: 0.6 for the first, 0.8 for the second.
 *
 * Lexical on purpose. An embedding call here would put a model round-trip (and its
 * failure modes) inside a create, and "semantic" similarity is LOOSER than this, not
 * tighter — precisely the wrong direction given the asymmetry above.
 */

/**
 * English + ticket-vocabulary filler. Dropped before comparison so "Fix the login
 * loop" and "Login loop fix" compare on their content words.
 *
 * Deliberately excludes domain verbs that DISTINGUISH work (`add`, `remove`, `delete`,
 * `disable`) — "Add dark mode" and "Remove dark mode" are opposite tickets, and folding
 * their verbs into filler would merge them.
 */
const FILLER = new Set([
  'a', 'an', 'the', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'is', 'are',
  'be', 'as', 'at', 'by', 'it', 'this', 'that', 'from', 'we', 'i', 'our', 'its',
  'should', 'must', 'need', 'needs', 'needed', 'when', 'then', 'so', 'but', 'if',
  'via', 'into', 'onto', 'per', 'up', 'out', 'over', 'do', 'does', 'not', 'no',
]);

/**
 * Conservative suffix stripper — enough to fold `fixing`/`fixes`/`fixed` onto `fix`
 * without a stemmer dependency, and refusing any strip that would leave a stem under
 * three characters (which is where an aggressive stemmer starts merging unrelated
 * words). Not linguistically complete; it does not need to be, because a missed fold
 * only costs a slightly lower similarity score, never a false merge.
 */
function stem(word: string): string {
  const cut = (suffix: string, replacement = ''): string | null => {
    if (!word.endsWith(suffix) || word.length - suffix.length + replacement.length < 3) return null;
    return word.slice(0, -suffix.length) + replacement;
  };
  // Order matters: longest/most specific suffix first.
  const stemmed =
    cut('ies', 'y') ?? cut('ing') ?? cut('ed') ?? cut('es') ?? cut('s') ?? word;
  // `running` → `runn` → `run`: undo the doubled consonant an -ing/-ed strip exposes.
  return /([bdfglmnprt])\1$/.test(stemmed) ? stemmed.slice(0, -1) : stemmed;
}

/**
 * The content tokens of a title: lowercased, split on non-alphanumerics, filler and
 * one-character tokens dropped, each stemmed. Exported because a caller that compares
 * one new title against MANY existing ones should tokenize the existing side once.
 */
export function titleTokens(title: string): Set<string> {
  const words = (title.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((w) => w.length >= 2 && !FILLER.has(w))
    .map(stem);
  return new Set(words);
}

/** Jaccard ≥ this counts as the same work. Set from the worked pairs in the header:
 *  a rephrasing lands at 0.8, a one-word substitution at 0.6. */
const MIN_JACCARD = 0.8;

/**
 * A title that is entirely CONTAINED in another ("Login redirect loop" inside "Fix the
 * login redirect loop") is the same work restated, but only once the shorter side
 * carries enough signal to be a title at all — below this it is a category, not a
 * ticket ("Update README" must not swallow "Update README and CHANGELOG").
 */
const MIN_CONTAINED_TOKENS = 3;

/** How many extra content words the longer side may add and still be the same work.
 *  Beyond this the addition is scope, not phrasing. */
const MAX_CONTAINMENT_SURPLUS = 2;

/**
 * Whitespace-collapsed, trimmed, lowercased — the canonical form of a title, and the
 * exact-match rule this module widens. Kept here rather than at each call site so
 * "same title" means one thing across every board that dedups.
 */
export function normalizeTitle(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * True when two titles describe the same piece of work.
 *
 * Identical after {@link normalizeTitle} is always true — that is the old exact-match
 * rule, kept as the fast path and as the answer for titles with no content words at
 * all. Beyond it, two titles match when their content-token sets are ≥
 * {@link MIN_JACCARD} similar, or when one set contains the other and the contained
 * side is a substantial title in its own right.
 */
export function isNearDuplicateTitle(a: string, b: string): boolean {
  if (normalizeTitle(a) === normalizeTitle(b)) return true;
  return areNearDuplicateTokens(titleTokens(a), titleTokens(b));
}

/**
 * The comparison itself, over already-tokenized titles — for a caller scanning a board
 * (tokenize the candidate ONCE, then compare against every row) rather than calling
 * {@link isNearDuplicateTitle} in a loop and re-tokenizing the same string N times.
 *
 * A title with no content words carries nothing to compare, so it never matches here;
 * {@link isNearDuplicateTitle} answers that case from the exact form instead.
 */
export function areNearDuplicateTokens(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const token of small) if (big.has(token)) shared += 1;
  const union = a.size + b.size - shared;
  if (union > 0 && shared / union >= MIN_JACCARD) return true;
  return (
    shared === small.size &&
    small.size >= MIN_CONTAINED_TOKENS &&
    big.size - small.size <= MAX_CONTAINMENT_SURPLUS
  );
}

/**
 * Find the first row whose title is the same work as `title`, or undefined.
 *
 * THE one place a create tool asks "does this already exist?", so the three boards that
 * dedup (tasks, objectives, key results) cannot drift apart on what counts as the same
 * title. Rows are scanned in the order given, so a caller that wants the oldest match
 * passes them oldest-first.
 */
export function findNearDuplicateByTitle<T>(
  title: string,
  rows: readonly T[],
  titleOf: (row: T) => unknown,
): T | undefined {
  const normalized = normalizeTitle(title);
  const target = titleTokens(title);
  return rows.find((row) => {
    const other = String(titleOf(row) ?? '');
    return normalizeTitle(other) === normalized || areNearDuplicateTokens(target, titleTokens(other));
  });
}

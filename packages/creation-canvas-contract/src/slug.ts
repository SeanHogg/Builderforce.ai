/**
 * THE slug primitive — one implementation for the api, the web app, the VS Code
 * client and this package.
 *
 * WHY HERE. Before this file there were fourteen copies of the same
 * lowercase → collapse → strip → cap pipeline: one in `api/src/domain/shared`,
 * per-module rewrites in advertising, marketplace, developer and investor, nine
 * inline spellings in the frontend (pages, canvas exports, brain export, metrics)
 * and a `toSlug` in this package's own `qa.ts`. They disagreed on the cap
 * (60/70/80/100/120/200), on the empty-input fallback, on whether diacritics were
 * folded (`München` → `munchen`) or stripped (`mnchen`), and on whether a trailing
 * separator left behind by the cap was removed. Two surfaces could therefore
 * produce two slugs for one title. This package is the one source both the api
 * and the frontend already compile against, so it is the one place the rule can
 * live without a new package.
 *
 * WHAT VARIES IS DATA, NOT CODE: every former copy is expressible as options.
 */
export interface SlugifyOptions {
  /** Maximum length in characters. Default 60. */
  maxLength?: number;
  /** Returned when slugging yields nothing. Default '' (an empty slug is allowed). */
  fallback?: string;
  /** Separator between words. Default '-'; metrics use '_'. */
  separator?: '-' | '_';
  /**
   * Fold diacritics (`é` → `e`) instead of dropping the letter. Default false so
   * slugs already stored by callers that stripped are unchanged; a caller that
   * wants readable non-ASCII input opts in.
   */
  foldDiacritics?: boolean;
  /**
   * Keep letters and digits from every script (`\p{L}\p{N}`) rather than only
   * `[a-z0-9]`. Default false. Public listing slugs opt in so a CJK title is not
   * reduced to its fallback.
   */
  unicode?: boolean;
}

const COMBINING_MARKS = /\p{M}+/gu;

/**
 * Lowercase → (optionally fold diacritics) → collapse every run of non-word
 * characters to one `separator` → strip leading/trailing separators → cap at
 * `maxLength` → strip again (the cap can leave a trailing separator) → `fallback`
 * when empty. Leading/trailing whitespace is folded into a separator and then
 * stripped, so no explicit `.trim()` is needed.
 */
export function slugify(input: string, opts: SlugifyOptions = {}): string {
  const separator = opts.separator ?? '-';
  const maxLength = opts.maxLength ?? 60;
  let value = String(input ?? '');
  if (opts.foldDiacritics) value = value.normalize('NFKD').replace(COMBINING_MARKS, '');
  value = value.toLowerCase();
  const nonWord = opts.unicode ? /[^\p{L}\p{N}]+/gu : /[^a-z0-9]+/g;
  const edge = separator === '_' ? /^_+|_+$/g : /^-+|-+$/g;
  const slug = value.replace(nonWord, separator).replace(edge, '').slice(0, maxLength).replace(edge, '');
  return slug || (opts.fallback ?? '');
}

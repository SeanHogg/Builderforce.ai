/**
 * Text Parser node kinds — pure, stateless string primitives for `regex-match`
 * and `html-to-text` (`cloudExecutor.ts`). Kept separate from `workflowExpr.ts`,
 * which is documented as scoped to the Flow Control expression engine
 * (transform/filter/branch/router/assert).
 *
 * Both functions bound their input to stay sandbox-safe: no backtracking-prone
 * regex construction (the pattern is compiled once, matched, and discarded —
 * never used to build a second dynamic regex) and a hard input-length cap so a
 * pathological payload can't turn a single node into a long-running match.
 */

const MAX_INPUT_LENGTH = 200_000;
const MAX_PATTERN_LENGTH = 500;
const VALID_FLAGS = /^[gimsuy]*$/;

export interface RegexMatchResult {
  matched: boolean;
  matches: string[];
  groups: Record<string, string> | null;
}

/**
 * Match `pattern` (with `flags`) against `input`. Never throws: an invalid
 * pattern/flags string, or oversized input/pattern, resolves to a "no match"
 * result rather than failing the node — the config field is user-authored, so
 * a typo should read as an empty match, not an execution error.
 */
export function regexMatch(pattern: string, flags: string, input: string): RegexMatchResult {
  const empty: RegexMatchResult = { matched: false, matches: [], groups: null };
  if (!pattern || pattern.length > MAX_PATTERN_LENGTH) return empty;
  const safeFlags = VALID_FLAGS.test(flags ?? '') ? flags : '';
  const text = (input ?? '').slice(0, MAX_INPUT_LENGTH);
  try {
    if (safeFlags.includes('g')) {
      const matches = [...text.matchAll(new RegExp(pattern, safeFlags))].map((m) => m[0]);
      return { matched: matches.length > 0, matches, groups: null };
    }
    const m = new RegExp(pattern, safeFlags).exec(text);
    if (!m) return empty;
    return { matched: true, matches: [...m].map((g) => g ?? ''), groups: m.groups ? { ...m.groups } : null };
  } catch {
    return empty;
  }
}

/** Strip tags/scripts/styles and collapse whitespace — a lightweight
 *  tag-stripper (not a full HTML parser), matching Make's "HTML to text". */
export function htmlToText(html: string): string {
  const text = (html ?? '').slice(0, MAX_INPUT_LENGTH);
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

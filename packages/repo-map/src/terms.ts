/**
 * Identifier-aware term splitting — a mirror of bf-index `terms.rs`, so the cloud map
 * and the local one agree on what a "word" of code is: `resolveMembership`,
 * `resolve_membership` and "resolve membership" all meet on the same terms.
 */

const IDENT_SPLIT = /[^A-Za-z0-9_]+/;

/** Identifier-shaped words (`[A-Za-z_][A-Za-z0-9_]*`) of at least `minLen` characters. */
export function identifiers(text: string, minLen: number): string[] {
  return text.split(IDENT_SPLIT).filter((w) => w.length >= minLen && !/^[0-9]/.test(w));
}

const isLower = (c: string | undefined): boolean => !!c && c >= 'a' && c <= 'z';
const isUpper = (c: string | undefined): boolean => !!c && c >= 'A' && c <= 'Z';

/** `parseHTTPResponse_v2` → ["parse", "http", "response", "v2"]. */
export function splitIdentifier(word: string): string[] {
  const parts: string[] = [];
  let cur = '';
  for (let i = 0; i < word.length; i += 1) {
    const c = word[i]!;
    if (c === '_' || c === '-') {
      if (cur) parts.push(cur);
      cur = '';
      continue;
    }
    if (cur) {
      const prev = word[i - 1];
      const boundary = (isLower(prev) && isUpper(c)) || (isUpper(prev) && isUpper(c) && isLower(word[i + 1]));
      if (boundary) {
        parts.push(cur);
        cur = '';
      }
    }
    cur += c.toLowerCase();
  }
  if (cur) parts.push(cur);
  return parts;
}

/** Lowercase search terms: each identifier plus its camel/snake parts. */
export function searchTerms(text: string): string[] {
  const out: string[] = [];
  for (const word of identifiers(text, 2)) {
    const parts = splitIdentifier(word);
    if (parts.length > 1) for (const p of parts) if (p.length >= 2) out.push(p);
    out.push(word.toLowerCase());
  }
  return out;
}

/** The same stopword list bf-index drops from a keyword query. */
export const STOPWORDS: ReadonlySet<string> = new Set([
  'the', 'and', 'for', 'where', 'what', 'how', 'does', 'is', 'are', 'of', 'to', 'in', 'on', 'we', 'do',
  'it', 'a', 'an', 'with', 'that', 'this', 'which', 'who', 'when', 'be', 'or', 'by', 'from', 'at', 'as',
]);

/** The distinct, stopword-free query terms (bf-index `fts_query`, without the FTS syntax). */
export function queryTerms(text: string): string[] {
  const seen = new Set<string>();
  for (const t of searchTerms(text)) if (t.length >= 2 && !STOPWORDS.has(t)) seen.add(t);
  return [...seen];
}

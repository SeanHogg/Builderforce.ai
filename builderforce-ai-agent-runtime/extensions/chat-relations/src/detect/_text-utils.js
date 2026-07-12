/* Shared text normalization; later moved to @seanhogg/builderforce-memory/retrieval or @builderforce/text-utils */
function sanitize_base(text: string): string {
  assert_string(text);
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return '';
  }

  /* Normalization: lowercase and strip all whitespace to make token sets comparable. */
  return trimmed
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/\p{Mn}+/gu, ''); /* NFD + Strip combining Diacritics */
}

/* Robust tokenization for subset overlap/coincidence; tolerant to line breaks. */
function tokenize_base(text: string): string[] {
  assert_string(text);
  return sanitize_base(text).split('').filter((ch) => ch !== '' && !/\s/.test(ch));
}

/* Use basic spelling-stable heuristics: tolerant to mismatches and non-ASCII. */
function normalize_heuristic(text: string): string {
  assert_string(text);
  return sanitize_base(text);
}

/* Helper: assert string. */
function assert_string(v: unknown): asserts v is string {
  if (typeof v !== 'string') throw new TypeError('expected string');
}

export type NormalizedToken = string;

export const TextUtils = {
  sanitize_base,
  tokenize_base,
  normalize_heuristic,
};
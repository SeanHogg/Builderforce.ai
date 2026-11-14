const COMBINING_MARKS = /\p{M}+/gu;
/**
 * Lowercase → (optionally fold diacritics) → collapse every run of non-word
 * characters to one `separator` → strip leading/trailing separators → cap at
 * `maxLength` → strip again (the cap can leave a trailing separator) → `fallback`
 * when empty. Leading/trailing whitespace is folded into a separator and then
 * stripped, so no explicit `.trim()` is needed.
 */
export function slugify(input, opts = {}) {
    const separator = opts.separator ?? '-';
    const maxLength = opts.maxLength ?? 60;
    let value = String(input ?? '');
    if (opts.foldDiacritics)
        value = value.normalize('NFKD').replace(COMBINING_MARKS, '');
    value = value.toLowerCase();
    const nonWord = opts.unicode ? /[^\p{L}\p{N}]+/gu : /[^a-z0-9]+/g;
    const edge = separator === '_' ? /^_+|_+$/g : /^-+|-+$/g;
    const slug = value.replace(nonWord, separator).replace(edge, '').slice(0, maxLength).replace(edge, '');
    return slug || (opts.fallback ?? '');
}
/**
 * The slug of a canvas game: the stem of every file the game produces on the
 * server AND the key the canvas game panel stores state under. One rule, shared,
 * so a state row can never miss the game on screen because the two sides trimmed
 * a title differently.
 */
export function gameSlug(title) {
    return slugify(title, { maxLength: 48, fallback: 'builderforce-game' });
}
//# sourceMappingURL=slug.js.map
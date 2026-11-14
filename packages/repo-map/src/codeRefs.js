/**
 * Code references inside free text — the paths and symbols a task names. A mirror of
 * bf-index `refs.rs`: only spans that are unambiguously code (a path with a source
 * extension or a slash, or a camelCase / snake_case / `call()` identifier) count, so
 * `npm test`, `--flag` and plain words never personalize the map.
 */
const SOURCE_EXTS = new Set([
    'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'rs', 'py', 'go', 'java', 'cs', 'kt', 'swift', 'rb', 'php', 'vue',
    'svelte', 'css', 'scss', 'sql', 'json', 'toml', 'yaml', 'yml', 'md',
]);
/** `src/a.ts:42` / `src/a.ts#L42` → `src/a.ts`. */
function stripLineSuffix(s) {
    const noHash = s.split('#')[0] ?? s;
    const colon = noHash.lastIndexOf(':');
    if (colon < 0)
        return noHash;
    const tail = noHash.slice(colon + 1);
    return tail && /^[0-9-]+$/.test(tail) ? noHash.slice(0, colon) : noHash;
}
function hasSourceExt(s) {
    const base = stripLineSuffix(s);
    const dot = base.lastIndexOf('.');
    if (dot <= 0)
        return false;
    return SOURCE_EXTS.has(base.slice(dot + 1).toLowerCase());
}
function hasInnerUpper(s) {
    return /[A-Z]/.test(s.slice(1)) && /[a-z]/.test(s);
}
/** `TODO`, `README` — all-caps words that are prose, not identifiers. */
function isScreamingWord(s) {
    return !s.includes('_') && /^[A-Z0-9]+$/.test(s);
}
function classify(span) {
    const s = span.trim();
    if (!s || s.length > 200 || /\s/.test(s))
        return null;
    if (s.startsWith('-') || s.startsWith('http://') || s.startsWith('https://') || s.startsWith('@'))
        return null;
    if (s.includes('/') || hasSourceExt(s)) {
        const p = stripLineSuffix(s.replace(/^(\.\/)+/, ''));
        if (p.includes('..') || p.includes('*') || (p.endsWith('/') && p.length < 3))
            return null;
        return hasSourceExt(p) || p.includes('/') ? { reference: p, kind: 'path' } : null;
    }
    const ident = s.replace(/(\(\))+$/, '');
    const segments = ident.split(/[.:]/);
    const last = segments[segments.length - 1] ?? ident;
    const codeLike = s.endsWith('()') || last.includes('_') || hasInnerUpper(last);
    const valid = last.length >= 4 && /^[A-Za-z_]/.test(last) && /^[A-Za-z0-9_]+$/.test(last);
    return codeLike && valid && !isScreamingWord(last) ? { reference: last, kind: 'symbol' } : null;
}
export function extractCodeRefs(text) {
    const out = [];
    const push = (r) => {
        if (r && !out.some((o) => o.reference === r.reference && o.kind === r.kind))
            out.push(r);
    };
    // Backticked spans first: the strongest signal that something is code.
    const ticks = text.split('`');
    for (let i = 1; i + 1 < ticks.length; i += 2)
        push(classify(ticks[i]));
    // Bare paths outside backticks.
    for (const word of text.split(/[\s(),"'`]+/)) {
        const w = word.replace(/[.:;]+$/, '');
        if (w.includes('/') && hasSourceExt(w))
            push(classify(w));
    }
    return out;
}
//# sourceMappingURL=codeRefs.js.map
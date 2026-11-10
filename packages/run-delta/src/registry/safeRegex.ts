/**
 * registry/safeRegex.ts — the gate a repo-supplied regex source (`.builderforce/delta.json` `io` /
 * `weakCrypto`) passes before the engine compiles it, so a repo file cannot ReDoS the run's
 * finalization. Conservative (it rejects some safe patterns, never accepts a catastrophic one):
 *
 *  - at most {@link MAX_OVERRIDE_REGEX_LENGTH} characters, and it must compile;
 *  - no back-references;
 *  - star height ≤ 1: no group under an UNBOUNDED quantifier (`*`, `+`, `{n,}`) that itself contains an
 *    unbounded quantifier (`(a+)+`, `(a*b)*`);
 *  - no alternation inside a group under an unbounded quantifier (`(a|ab)*`, overlap-prone).
 *
 * Bounded quantifiers (`?`, `{n}`, `{n,m}`) are allowed anywhere.
 */

export const MAX_OVERRIDE_REGEX_LENGTH = 200;

export type UnsafeReason = 'too-long' | 'invalid' | 'backreference' | 'nested-quantifier' | 'quantified-alternation' | 'adjacent-quantifier';

interface Frame { unbounded: boolean; alternation: boolean; start: number; bars: number[] }

/** The unbounded quantifier starting at `i`, if any: `*`, `+`, or `{n,}`. Returns its length, 0 for bounded/none. */
function quantifierAt(src: string, i: number): { unbounded: boolean; length: number } {
    const ch = src[i];
    if (ch === '*' || ch === '+') return { unbounded: true, length: 1 + (src[i + 1] === '?' ? 1 : 0) };
    if (ch === '?') return { unbounded: false, length: 1 };
    if (ch === '{') {
        const m = /^\{(\d+)(,(\d*))?\}/.exec(src.slice(i));
        if (m) return { unbounded: m[2] !== undefined && m[3] === '', length: m[0].length };
    }
    return { unbounded: false, length: 0 };
}

/** Why a repo regex source is unsafe, or `undefined` when it may be compiled. */
export function unsafeRegex(src: string): UnsafeReason | undefined {
    if (src.length > MAX_OVERRIDE_REGEX_LENGTH) return 'too-long';
    try { new RegExp(src); } catch { return 'invalid'; }
    return regexHazards(src).first ?? (adjacentQuantifiers(src) ? 'adjacent-quantifier' : undefined);
}

/**
 * Polynomial ReDoS: two ADJACENT unbounded quantified atoms that can match the same character (`\d+\d+`,
 * `.*.*`, `\s*\s*x`, `a*\w+`) split one run of input in O(n²) ways on a failing match. Checked at every
 * group depth (each group's body on its own); a sub-group atom counts as "can match anything".
 */
function adjacentQuantifiers(src: string): boolean {
    const bodies = [src];
    for (let i = 0; i < src.length; i++) {
        if (src[i] === '\\') { i++; continue; }
        if (src[i] === '(') {
            let depth = 0, end = i;
            for (; end < src.length; end++) {
                if (src[end] === '\\') { end++; continue; }
                if (src[end] === '(') depth++;
                else if (src[end] === ')' && --depth === 0) break;
            }
            const inner = src.slice(i + 1, end).replace(/^\?(?:[:=!]|<[=!]|<[A-Za-z_$][\w$]*>)/, '');
            bodies.push(...inner.split(/(?<!\\)\|/));
        }
    }
    for (const body of bodies) {
        const atoms = atomsOf(body);
        for (let k = 0; k + 1 < atoms.length; k++) {
            const a = atoms[k]!, b = atoms[k + 1]!;
            if (!a.unbounded || !b.unbounded) continue;
            const chars = (t: string) => (t.startsWith('(') ? undefined : firstChars(t === '.' ? undefined : t, ''));
            if (intersects(chars(a.text), chars(b.text))) return true;
        }
    }
    return false;
}

/** The structural hazards of one regex source (the walk {@link unsafeRegex} and the `regex-redos` rule share). */
export interface RegexHazards {
    /** The first hazard in source order: what {@link unsafeRegex} reports. */
    first?: 'backreference' | 'nested-quantifier' | 'quantified-alternation';
    /** Star height > 1 (`(a+)+`): the safe-regex criterion. */
    nestedQuantifier: boolean;
    /**
     * A nested quantifier that is AMBIGUOUS at the repetition boundary: the group's last unbounded atom can end
     * the group (only optional atoms follow it) and can match a char the group can start with (`(a+)+`,
     * `(\s*\w+)*`). A delimited one (`(\d+,)+`) backtracks linearly and is not.
     */
    nestedAmbiguous: boolean;
    /** An unbounded group whose alternatives can start with the same character (`(a|ab)*`, `(\\.|[^"])*`). */
    overlappingAlternation: boolean;
}

/** Printable ASCII, tab and newline, plus non-ASCII letters / spaces / separators: the probe alphabet for first-character overlap. */
const PROBES: readonly string[] = [
    '\t', '\n', ...Array.from({ length: 95 }, (_, k) => String.fromCharCode(32 + k)),
    'é', 'ß', 'Ω', 'ж', '中', 'ア', ' ', ' ', '　',
];

/** The first atom of one alternative: an escape, a class, a char; `undefined` = can start with anything (group, `.`, empty). */
function firstAtom(alt: string): string | undefined {
    if (alt === '' || alt[0] === '(' || alt[0] === '.') return undefined;
    if (alt[0] === '\\') return alt.slice(0, 2);
    if (alt[0] === '[') {
        for (let i = 1; i < alt.length; i++) {
            if (alt[i] === '\\') { i++; continue; }
            if (alt[i] === ']' && i > (alt[1] === '^' ? 2 : 1)) return alt.slice(0, i + 1);
        }
        return undefined;
    }
    return /[\^$]/.test(alt[0]!) ? undefined : alt[0];
}

/** The probe chars an atom can match; `undefined` = all of them. */
function firstChars(atom: string | undefined, flags: string): ReadonlySet<string> | undefined {
    if (atom === undefined) return undefined;
    try {
        const re = new RegExp(`^(?:${atom})`, flags.replace(/[gy]/g, ''));
        return new Set(PROBES.filter((c) => re.test(c)));
    } catch { return undefined; }
}

const bodyStartOf = (src: string, group: Frame): number =>
    group.start + 1 + (/^\?(?:[:=!]|<[=!]|<[A-Za-z_$][\w$]*>)/.exec(src.slice(group.start + 1))?.[0].length ?? 0);

/** Two first-char sets intersect (`undefined` = any char, so always). */
function intersects(x: ReadonlySet<string> | undefined, y: ReadonlySet<string> | undefined): boolean {
    if (!x || !y) return true;
    for (const c of x) if (y.has(c)) return true;
    return false;
}

function alternativesOverlap(src: string, group: Frame, close: number, flags: string): boolean {
    const cuts = [bodyStartOf(src, group) - 1, ...group.bars, close];
    const sets = cuts.slice(1).map((end, k) => firstChars(firstAtom(src.slice(cuts[k]! + 1, end)), flags));
    for (let a = 0; a < sets.length; a++) {
        for (let b = a + 1; b < sets.length; b++) if (intersects(sets[a], sets[b])) return true;
    }
    return false;
}

interface Atom { text: string; unbounded: boolean; optional: boolean }

/** The top-level atoms of a group body (escapes, classes, sub-groups, chars), each with its quantifier. */
function atomsOf(body: string): Atom[] {
    const out: Atom[] = [];
    for (let i = 0; i < body.length;) {
        let end = i + 1;
        if (body[i] === '\\') end = i + 2;
        else if (body[i] === '[') {
            for (end = i + 1; end < body.length; end++) { if (body[end] === '\\') { end++; continue; } if (body[end] === ']' && end > i + 1) break; }
            end++;
        } else if (body[i] === '(') {
            let depth = 0, inClass = false;
            for (end = i; end < body.length; end++) {
                const c = body[end]!;
                if (c === '\\') { end++; continue; }
                if (inClass) { if (c === ']') inClass = false; continue; }
                if (c === '[') inClass = true;
                else if (c === '(') depth++;
                else if (c === ')' && --depth === 0) break;
            }
            end++;
        }
        const q = quantifierAt(body, end);
        const quant = body.slice(end, end + q.length);
        out.push({ text: body.slice(i, end), unbounded: q.unbounded, optional: quant.startsWith('?') || quant.startsWith('*') || /^\{0[,}]/.test(quant) });
        i = end + q.length;
    }
    return out;
}

/** Whether a nested-quantifier group is ambiguous at its repetition boundary (see {@link RegexHazards.nestedAmbiguous}). */
function nestedAmbiguous(src: string, group: Frame, close: number, flags: string): boolean {
    if (group.bars.length > 0) return true;
    const atoms = atomsOf(src.slice(bodyStartOf(src, group), close));
    let last = -1;
    for (let k = atoms.length - 1; k >= 0; k--) if (atoms[k]!.unbounded) { last = k; break; }
    if (last < 0) return true; // the unbounded part is deeper inside a sub-group: stay conservative
    if (!atoms.slice(last + 1).every((a) => a.optional)) return false; // delimited: a required atom follows
    // The chars the group can START with: leading atoms up to and including the first required one.
    let starts: Set<string> | undefined = new Set();
    for (const a of atoms) {
        const chars = firstChars(firstAtom(a.text), flags);
        if (!chars) { starts = undefined; break; }
        for (const c of chars) starts.add(c);
        if (!a.optional) break;
    }
    return intersects(firstChars(firstAtom(atoms[last]!.text), flags), starts);
}

export function regexHazards(src: string, flags = ''): RegexHazards {
    const out: RegexHazards = { nestedQuantifier: false, nestedAmbiguous: false, overlappingAlternation: false };
    const note = (h: NonNullable<RegexHazards['first']>) => { out.first ??= h; };
    const stack: Frame[] = [{ unbounded: false, alternation: false, start: -1, bars: [] }];
    let inClass = false;
    for (let i = 0; i < src.length; i++) {
        const ch = src[i]!;
        if (ch === '\\') {
            if (/[1-9k]/.test(src[i + 1] ?? '')) note('backreference');
            i++;
            continue;
        }
        if (inClass) { if (ch === ']') inClass = false; continue; }
        if (ch === '[') { inClass = true; continue; }
        if (ch === '(') { stack.push({ unbounded: false, alternation: false, start: i, bars: [] }); continue; }
        if (ch === '|') { const top = stack[stack.length - 1]!; top.alternation = true; top.bars.push(i); continue; }
        if (ch === ')') {
            if (stack.length === 1) continue; // unbalanced: the caller's compile check reports it
            const group = stack.pop()!;
            const q = quantifierAt(src, i + 1);
            if (q.unbounded && group.unbounded) {
                note('nested-quantifier');
                out.nestedQuantifier = true;
                if (nestedAmbiguous(src, group, i, flags)) out.nestedAmbiguous = true;
            }
            if (q.unbounded && group.alternation) {
                note('quantified-alternation');
                if (alternativesOverlap(src, group, i, flags)) out.overlappingAlternation = true;
            }
            const parent = stack[stack.length - 1]!;
            parent.unbounded ||= group.unbounded || q.unbounded;
            i += q.length;
            continue;
        }
        const q = quantifierAt(src, i);
        if (q.unbounded) stack[stack.length - 1]!.unbounded = true;
        if (ch === '{' && q.length > 0) i += q.length - 1;
    }
    return out;
}

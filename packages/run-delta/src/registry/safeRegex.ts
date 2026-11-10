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

export type UnsafeReason = 'too-long' | 'invalid' | 'backreference' | 'nested-quantifier' | 'quantified-alternation';

interface Frame { unbounded: boolean; alternation: boolean }

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
    const stack: Frame[] = [{ unbounded: false, alternation: false }];
    let inClass = false;
    for (let i = 0; i < src.length; i++) {
        const ch = src[i]!;
        if (ch === '\\') {
            if (/[1-9k]/.test(src[i + 1] ?? '')) return 'backreference';
            i++;
            continue;
        }
        if (inClass) { if (ch === ']') inClass = false; continue; }
        if (ch === '[') { inClass = true; continue; }
        if (ch === '(') { stack.push({ unbounded: false, alternation: false }); continue; }
        if (ch === '|') { stack[stack.length - 1]!.alternation = true; continue; }
        if (ch === ')') {
            const group = stack.pop()!;
            const q = quantifierAt(src, i + 1);
            if (q.unbounded && group.unbounded) return 'nested-quantifier';
            if (q.unbounded && group.alternation) return 'quantified-alternation';
            const parent = stack[stack.length - 1]!;
            parent.unbounded ||= group.unbounded || q.unbounded;
            i += q.length;
            continue;
        }
        const q = quantifierAt(src, i);
        if (q.unbounded) stack[stack.length - 1]!.unbounded = true;
        if (ch === '{' && q.length > 0) i += q.length - 1;
    }
    return undefined;
}

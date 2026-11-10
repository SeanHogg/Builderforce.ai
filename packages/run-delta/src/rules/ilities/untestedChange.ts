/**
 * rules/ilities/untestedChange.ts — `untested-change` (ilities.functional-suitability, warn; C7): a
 * changed implementation file (JS/TS, not a test, snapshot or `.d.ts`) whose CODE changed — comments and
 * whitespace do not count — while no test the run added or changed touches it. A test touches a file when
 * it imports it (a relative specifier resolving to it, a path-alias specifier `@/…` / `~/…` / `#…` ending
 * in its module name, or an edge in the after side's import facts). Scripts, config modules and type-only
 * modules (no runtime declaration) are not implementation. One finding per file, on the after side.
 *
 * The C7 link to a ticket's acceptance criteria needs the run's ticket, which the delta input does not
 * carry; it is not part of this rule.
 *
 * Heuristic: text-level imports; WS4 call facts (test → symbol) replace it.
 */

import type { DeltaRule, RuleFinding } from '../../contract.js';
import { filePairs, isJsPath, isSnapshotPath, isTestPath } from '../support/files.js';
import { heuristicFinding, ruleIdentity } from '../support/identity.js';
import { isScriptPath } from '../support/scripts.js';
import { isTested, testedModules } from '../support/testedModules.js';

/** Config modules (`vite.config.ts`, `config/x.ts`, `.eslintrc.js`): behaviour is configuration, not code under test. */
const CONFIG = /(^|\/)(?:[^/]+\.config\.[cm]?[jt]s|config\/[^/]+|\.[^/]*rc\.[cm]?[jt]s)$/;
/** Type-only modules by name (`types.ts`, `x.types.ts`, `types/…`). */
const TYPES_ONLY_PATH = /(^|\/)(?:types?\.[cm]?ts|[^/]+\.types?\.[cm]?ts|types\/[^/]+)$/;
/** A module with runtime code declares a value: a function, a variable, a class, an enum or an arrow. */
const DECLARES_CODE = /(?<![\w$.])(?:function|const|let|var|class|enum)\s|=>/;

const isSpace = (c: number): boolean => c === 32 || c === 10 || c === 9 || c === 13;

const CHUNK = 65_536;
/** Only whitespace from `lastIndex` to the end — the same four chars as {@link isSpace} (not Unicode `\s`). */
const BLANK_TAIL = /[ \t\r\n]*$/y;

/** Length of the common prefix (`dir` 1) or suffix (`dir` -1), in native chunk compares then per char. */
function common(a: string, b: string, dir: 1 | -1): number {
    const max = Math.min(a.length, b.length);
    let n = 0;
    const same = (k: number, len: number) => (dir === 1
        ? a.startsWith(b.slice(k, k + len), k)
        : a.endsWith(b.slice(b.length - k - len, b.length - k), a.length - k));
    while (n + CHUNK <= max && same(n, CHUNK)) n += CHUNK;
    while (n < max && (dir === 1 ? a.charCodeAt(n) === b.charCodeAt(n) : a.charCodeAt(a.length - 1 - n) === b.charCodeAt(b.length - 1 - n))) n++;
    return n;
}

/**
 * Equal once all whitespace is dropped. The identical prefix and suffix are skipped natively (backed off to
 * a whitespace boundary), so only the edited middle is walked by the two-pointer pass.
 */
function sameIgnoringWhitespace(a: string, b: string): boolean {
    if (a === b) return true;
    // Fast path (an edit at the end of the file, the common case): ONE native prefix test, then a whitespace check
    // of the remainder — no per-char walk and no chunk slices over a multi-MB file.
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    if (long.startsWith(short)) { BLANK_TAIL.lastIndex = short.length; return BLANK_TAIL.test(long); }
    let start = common(a, b, 1);
    while (start > 0 && !isSpace(a.charCodeAt(start - 1))) start--;
    let tail = Math.min(common(a, b, -1), a.length - start, b.length - start);
    while (tail > 0 && !isSpace(a.charCodeAt(a.length - tail))) tail--;
    const ea = a.length - tail, eb = b.length - tail;
    let i = start, j = start;
    for (;;) {
        while (i < ea && isSpace(a.charCodeAt(i))) i++;
        while (j < eb && isSpace(b.charCodeAt(j))) j++;
        if (i === ea || j === eb) return i === ea && j === eb;
        if (a.charCodeAt(i) !== b.charCodeAt(j)) return false;
        i++; j++;
    }
}

export const untestedChange: DeltaRule = {
    id: 'untested-change',
    version: 2,
    dimension: 'ilities.functional-suitability',
    reads: ['content'],
    derive(input) {
        const pairs = filePairs(input);
        const tested = testedModules(input);
        const after: RuleFinding[] = [];
        for (const p of pairs) {
            if (!p.after || !isJsPath(p.path) || isTestPath(p.path) || isSnapshotPath(p.path) || /\.d\.[cm]?ts$/.test(p.path)) continue;
            if (isScriptPath(p.path) || CONFIG.test(p.path) || TYPES_ONLY_PATH.test(p.path) || !DECLARES_CODE.test(p.after.bare)) continue;
            if (p.before && sameIgnoringWhitespace(p.before.code, p.after.code)) continue;
            if (isTested(tested, p.path)) continue;
            after.push(heuristicFinding(
                ruleIdentity(untestedChange, 'file', p.path, { members: [p.path] }),
                'warn',
                { file: p.path },
                [{ side: 'after', path: p.after.sidePath }],
            ));
        }
        return { before: [], after };
    },
};

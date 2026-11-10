/**
 * rules/cookieInsecure.ts — `cookie-insecure` (security, warn; C5.6): a cookie set in a changed non-test
 * file without `httpOnly`, `secure` or `sameSite` (absent, or `httpOnly` / `secure` set to `false`), via
 * `setCookie(` (Hono), `.cookie(` (Express), `cookies.set(` (Koa / Next), or a raw `Set-Cookie` header
 * lacking `HttpOnly` / `Secure` / `SameSite`. `params.missing` lists the flags. Anchored on the call
 * head, so adding a flag keeps the identity and adding all of them resolves it. A missing `sameSite`
 * alone is not reported, and options passed as a variable are skipped (not readable here).
 *
 * Heuristic: text-level; the options must be inline in the call.
 */

import type { DeltaRule } from '../contract.js';
import { compileEntries } from './support/entryForms.js';
import { isCodePath, isTestPath, matchClose, type TextView } from './support/files.js';
import { regexHits, stateSides, type Hit } from './support/stateRule.js';
import { topLevelArgs } from './support/statements.js';
import { liveText } from './support/taint.js';

const SETTERS = compileEntries({ cookie: ['setCookie(', '.cookie(', 'cookies.set('] }, 'any');
const HEADER = /Set-Cookie['"\x60]?\s*[,:]/gi;

/** Flags an options text lacks: a key absent, or `httpOnly` / `secure` explicitly false. */
function missingFlags(opts: string, header: boolean): string[] {
    const missing: string[] = [];
    if (header) {
        if (!/\bHttpOnly\b/i.test(opts)) missing.push('httpOnly');
        if (!/\bSecure\b/i.test(opts)) missing.push('secure');
        if (!/\bSameSite\s*=/i.test(opts)) missing.push('sameSite');
        return missing;
    }
    if (!/\bhttpOnly\s*:/i.test(opts) || /\bhttpOnly\s*:\s*false\b/i.test(opts)) missing.push('httpOnly');
    if (!/\bsecure\s*:/.test(opts) || /\bsecure\s*:\s*false\b/.test(opts)) missing.push('secure');
    if (!/\bsameSite\s*:/i.test(opts)) missing.push('sameSite');
    return missing;
}

/** A missing `sameSite` ALONE is not reported (browsers default to `Lax`); it is listed beside a missing httpOnly/secure. */
const reportable = (missing: readonly string[]): boolean => missing.some((m) => m !== 'sameSite');

/** Which argument holds the options: `setCookie(c, name, value, opts)` (Hono), else `(name, value, opts)`. */
const optionsIndex = (entry: string): number => (entry === 'setCookie(' ? 3 : 2);

function hitsOf(view: TextView): Hit[] {
    if (!/cookie/i.test(view.code)) return [];
    const live = liveText(view);
    const hits: Hit[] = [];
    for (const h of SETTERS.scan(live)) {
        const open = h.offset + h.length - 1;
        const close = matchClose(live, open);
        if (close < 0 || /\breq\s*$/.test(live.slice(Math.max(0, h.offset - 8), h.offset))) continue; // `c.req.cookie(` reads
        const opts = topLevelArgs(live, open, close)[optionsIndex(h.entry)];
        // Options passed as a variable or a call cannot be read here: no finding rather than a guess.
        if (opts && !live.slice(opts[0], opts[1]).trim().startsWith('{')) continue;
        const missing = missingFlags(opts ? view.code.slice(opts[0], opts[1]) : '', false);
        if (reportable(missing)) hits.push({ offset: h.offset, length: h.length, key: 'cookie', params: { missing: missing.join(', ') } });
    }
    for (const { offset, match } of regexHits(HEADER, view.code)) { // `code` has comments blanked, strings kept
        const missing = missingFlags(view.lineText(offset, view.code), true);
        if (reportable(missing)) hits.push({ offset, length: match[0].length, key: 'set-cookie', params: { missing: missing.join(', ') } });
    }
    return hits;
}

export const cookieInsecure: DeltaRule = {
    id: 'cookie-insecure',
    version: 1,
    dimension: 'security',
    reads: ['content'],
    derive(input) {
        return stateSides(cookieInsecure, { files: (p) => isCodePath(p) && !isTestPath(p), hits: hitsOf, severity: 'warn' }, input);
    },
};

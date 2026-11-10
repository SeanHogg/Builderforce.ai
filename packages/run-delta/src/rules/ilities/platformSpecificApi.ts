/**
 * rules/ilities/platformSpecificApi.ts — `platform-specific-api` (ilities.flexibility, warn; C7
 * portability), by key, in a changed non-test JS/TS file:
 *
 *  - `windows-path`: a string literal holding a drive path (`'C:\\…'`);
 *  - `posix-path`: a string literal starting at a POSIX system path (`/bin/`, `/usr/bin/`, `/tmp/`,
 *    `/dev/null`, `/etc/`, `/proc/`);
 *  - `posix-shell`: `exec` / `spawn` (sync or not) of a POSIX-only command (`rm`, `cp`, `grep`, …);
 *  - `backslash-separator`: a hard-coded `'\\'` path separator (split / join / concatenation).
 *
 * Heuristic: text-level; WS4 capability facts by layer replace it.
 */

import type { DeltaRule } from '../../contract.js';
import { isJsPath, isTestPath, type TextView } from '../support/files.js';
import { stateSides, type Hit } from '../support/stateRule.js';
import { glued } from '../support/statements.js';

/**
 * ONE literal-led alternation pass over the comment-masked code. Groups: 1 = opening quote, then 2 a drive
 * path, 3 a POSIX system path, 4 a lone `'\\'` string; 5 = an exec / spawn call, 6 = its quote.
 */
const SCAN = /(['"`])(?:([A-Za-z]:\\\\)|(\/bin\/|\/usr\/(?:local\/)?bin\/|\/tmp\/|\/dev\/null|\/etc\/|\/proc\/)|(\\\\)\1)|(exec|execSync|spawn|spawnSync|execFile|execFileSync)\s*\(\s*(['"`])(?:rm|cp|mv|ls|cat|grep|sed|awk|chmod|chown|ln|touch|which|kill|tar)\b/g;
const SEPARATOR_USE = /(?:\b(?:split|join)\s*\(\s*|\+\s*)$/;

function hitsOf(view: TextView): Hit[] {
    const { code, bare } = view;
    const hits: Hit[] = [];
    for (const m of code.matchAll(SCAN)) {
        // The quote must be real code (masking keeps the quotes of real strings, blanks those in comments).
        const q = m[5] ? m.index + m[0].lastIndexOf(m[6]!, m[0].length - 1) : m.index;
        if (bare[q] !== code[q]) continue;
        let key: string;
        if (m[5]) {
            if (glued(code, m.index)) continue;
            key = 'posix-shell';
        } else if (m[2]) key = 'windows-path';
        else if (m[3]) key = 'posix-path';
        else if (SEPARATOR_USE.test(code.slice(Math.max(0, m.index - 12), m.index))) key = 'backslash-separator';
        else continue;
        hits.push({ offset: m.index, length: m[0].length, key });
    }
    return hits;
}

export const platformSpecificApi: DeltaRule = {
    id: 'platform-specific-api',
    version: 1,
    dimension: 'ilities.flexibility',
    reads: ['content'],
    derive(input) {
        return stateSides(platformSpecificApi, { files: (p) => isJsPath(p) && !isTestPath(p), hits: hitsOf, severity: 'warn' }, input);
    },
};

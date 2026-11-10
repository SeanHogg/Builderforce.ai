/**
 * rules/quality/catchAllAdded.ts — `catch-all-added` (quality, warn; C8.2 test integrity): a catch-all
 * handler — a `catch` clause or `.catch(…)` handler that neither rethrows nor looks at the caught error
 * — in changed non-test JS/TS. A handler passed by reference (`.catch(reportError)`, `.catch(next)`) forwards
 * the error, and a destructured parameter (`({ code }) =>`) reads it: neither is a catch-all. An agent judged by failing tests can make them pass by wrapping the
 * failing code in one; the delta shows each new one. The anchor hashes the handler's header, so a body
 * edit keeps its identity.
 *
 * "Around previously failing code" needs the run's test results, which the delta input does not carry;
 * every new catch-all is reported.
 *
 * Heuristic: text-level; WS4 tree-sitter body facts replace it.
 */

import type { DeltaRule } from '../../contract.js';
import { bodyOf, catchesOf, ignoresError, rethrows } from '../support/catches.js';
import { isJsPath, isTestPath, type TextView } from '../support/files.js';
import { stateSides, type Hit } from '../support/stateRule.js';

function hitsOf(view: TextView): Hit[] {
    return catchesOf(view)
        .filter((s) => !rethrows(bodyOf(view, s)) && ignoresError(view, s))
        .map((s) => ({ offset: s.offset, length: s.length, key: s.kind === 'clause' ? 'catch' : '.catch' }));
}

export const catchAllAdded: DeltaRule = {
    id: 'catch-all-added',
    version: 2,
    dimension: 'quality',
    reads: ['content'],
    derive(input) {
        return stateSides(catchAllAdded, { files: (p) => isJsPath(p) && !isTestPath(p), hits: hitsOf, severity: 'warn' }, input);
    },
};

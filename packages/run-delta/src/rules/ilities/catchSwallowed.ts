/**
 * rules/ilities/catchSwallowed.ts — `catch-swallowed` (ilities.reliability, warn; C7): an error handler
 * that does nothing — an empty `catch {}` (a comment-only body counts as empty) or a `.catch(…)` handler
 * that is `() => {}`, `() => undefined | null | void 0`, or a bare `noop`. In changed non-test JS/TS.
 * The anchor hashes the handler's header, so editing an unrelated line keeps its identity.
 *
 * Heuristic: text-level; WS4 tree-sitter body facts replace it.
 */

import type { DeltaRule } from '../../contract.js';
import { bodyOf, catchesOf } from '../support/catches.js';
import { isJsPath, isTestPath, type TextView } from '../support/files.js';
import { stateSides, type Hit } from '../support/stateRule.js';

const EMPTY_HANDLER = /^\s*(?:(?:async\s+)?(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*=>\s*(?:\{\s*\}|undefined|null|void\s+0)|noop|_\.noop)\s*$/;

function hitsOf(view: TextView): Hit[] {
    return catchesOf(view)
        .filter((s) => (s.kind === 'clause' ? bodyOf(view, s).trim() === '' : EMPTY_HANDLER.test(bodyOf(view, s))))
        .map((s) => ({ offset: s.offset, length: s.length, key: s.kind === 'clause' ? 'catch' : '.catch' }));
}

export const catchSwallowed: DeltaRule = {
    id: 'catch-swallowed',
    version: 1,
    dimension: 'ilities.reliability',
    reads: ['content'],
    derive(input) {
        return stateSides(catchSwallowed, { files: (p) => isJsPath(p) && !isTestPath(p), hits: hitsOf, severity: 'warn' }, input);
    },
};

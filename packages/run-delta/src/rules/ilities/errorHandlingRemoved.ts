/**
 * rules/ilities/errorHandlingRemoved.ts — `error-handling-removed` (ilities.reliability, warn; C7
 * "removed error branches"): a changed non-test JS/TS file that has FEWER error handlers (`catch`
 * clauses plus `.catch(…)` handlers) after the run than before. One finding per file, on the after
 * side, with both counts. A deleted file is not reported (its handlers went with it).
 *
 * Heuristic: a count, not a per-branch match; WS4 tree-sitter body facts replace it.
 */

import type { DeltaRule, RuleFinding } from '../../contract.js';
import { catchesOf } from '../support/catches.js';
import { filePairs, isJsPath, isTestPath } from '../support/files.js';
import { heuristicFinding, ruleIdentity } from '../support/identity.js';

export const errorHandlingRemoved: DeltaRule = {
    id: 'error-handling-removed',
    version: 1,
    dimension: 'ilities.reliability',
    reads: ['content'],
    derive(input) {
        const after: RuleFinding[] = [];
        for (const p of filePairs(input)) {
            if (!p.before || !p.after || !isJsPath(p.path) || isTestPath(p.path)) continue;
            const b = catchesOf(p.before).length, a = catchesOf(p.after).length;
            if (a >= b) continue;
            after.push(heuristicFinding(
                ruleIdentity(errorHandlingRemoved, 'file', p.path, { members: [p.path] }),
                'warn',
                { file: p.path, before: b, after: a },
                [{ side: 'before', path: p.before.sidePath, note: String(b) }, { side: 'after', path: p.after.sidePath, note: String(a) }],
            ));
        }
        return { before: [], after };
    },
};

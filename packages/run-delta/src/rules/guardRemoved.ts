/**
 * rules/guardRemoved.ts — `guard-removed` (security, error; C5.1): a route registration in a changed
 * file lost a registry guard and nothing is left on its chain within the file. Evidence carries the
 * route key and the guard. Blocks an autonomous run (§12.5).
 *
 * Heuristic: text-level route and guard-chain facts; WS4 tree-sitter entry-point facts replace them.
 */

import type { DeltaRule } from '../contract.js';
import { guardChanges } from './support/guardDiff.js';
import { heuristicFinding, ruleIdentity } from './support/identity.js';

export const guardRemoved: DeltaRule = {
    id: 'guard-removed',
    version: 1,
    dimension: 'security',
    reads: ['content'],
    derive(input) {
        const after = guardChanges(input).filter((c) => c.kind === 'removed').map((c) => heuristicFinding(
            ruleIdentity(guardRemoved, 'route', `${c.path}#${c.after.key}#${c.guard}`, { members: [c.path] }),
            'error',
            { route: c.after.key, guard: c.guard, file: c.path },
            [
                { side: 'before', path: c.beforePath, line: c.before.line, note: `${c.before.key} ${c.guard}` },
                { side: 'after', path: c.afterPath, line: c.after.line, note: c.after.key },
            ],
        ));
        return { before: [], after };
    },
};

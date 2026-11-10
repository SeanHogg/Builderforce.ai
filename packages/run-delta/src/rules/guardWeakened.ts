/**
 * rules/guardWeakened.ts — `guard-weakened` (security, warn; C5.1): a route's guard was replaced by a
 * lower-ranked one (registry rank), e.g. `requireSuperadmin` → `requireAuth`.
 *
 * Heuristic: text-level route and guard-chain facts; WS4 tree-sitter entry-point facts replace them.
 */

import type { DeltaRule } from '../contract.js';
import { guardChanges } from './support/guardDiff.js';
import { heuristicFinding, ruleIdentity } from './support/identity.js';

export const guardWeakened: DeltaRule = {
    id: 'guard-weakened',
    version: 1,
    dimension: 'security',
    reads: ['content'],
    derive(input) {
        const after = guardChanges(input).filter((c) => c.kind === 'weakened').map((c) => heuristicFinding(
            ruleIdentity(guardWeakened, 'route', `${c.path}#${c.after.key}#${c.guard}`, { members: [c.path] }),
            'warn',
            { route: c.after.key, guard: c.guard, replacement: c.replacement ?? '', file: c.path },
            [
                { side: 'before', path: c.beforePath, line: c.before.line, note: `${c.before.key} ${c.guard}` },
                { side: 'after', path: c.afterPath, line: c.after.line, note: `${c.after.key} ${c.replacement ?? ''}` },
            ],
        ));
        return { before: [], after };
    },
};

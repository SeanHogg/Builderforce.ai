/**
 * rules/guardWeakened.ts — `guard-weakened` (security, warn; C5.1): a route's guard was replaced by a
 * lower-ranked one (registry rank), e.g. `requireSuperadmin` → `requireAuth`, on its chain or across a
 * re-keyed route with the same handler.
 *
 * Heuristic: text-level route and guard-chain facts; WS4 tree-sitter entry-point facts replace them.
 */

import type { DeltaRule } from '../contract.js';
import { guardEvidence } from './guardRemoved.js';
import { heuristicFinding, ruleIdentity } from './support/identity.js';
import { routeDelta } from './support/routeDelta.js';

export const guardWeakened: DeltaRule = {
    id: 'guard-weakened',
    version: 1,
    dimension: 'security',
    reads: ['content'],
    derive(input) {
        const after = routeDelta(input).guards.filter((c) => c.kind === 'weakened').map((c) => heuristicFinding(
            ruleIdentity(guardWeakened, 'route', `${c.path}#${c.key}#${c.guard}`, { members: [c.path] }),
            'warn',
            { route: c.key, guard: c.guard, replacement: c.replacement ?? '', via: c.via, file: c.path },
            guardEvidence(c),
        ));
        return { before: [], after };
    },
};

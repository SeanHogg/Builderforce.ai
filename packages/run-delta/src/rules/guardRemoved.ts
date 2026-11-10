/**
 * rules/guardRemoved.ts — `guard-removed` (security, error; C5.1): a route or middleware in a changed
 * file lost a registry guard and nothing at least as strong covers it any more — on its own chain, by a
 * deleted guarded `.use(…)`, by a re-keyed route with the same handler, or as a new unguarded route
 * among all-guarded siblings (`params.via`). Evidence carries the route key and the guard. Blocks an
 * autonomous run (§12.5).
 *
 * Heuristic: text-level route and guard-chain facts; WS4 tree-sitter entry-point facts replace them.
 */

import type { DeltaRule, Evidence } from '../contract.js';
import { heuristicFinding, ruleIdentity } from './support/identity.js';
import { routeDelta, type GuardChange } from './support/routeDelta.js';

export function guardEvidence(c: GuardChange): Evidence[] {
    const out: Evidence[] = [];
    if (c.before) out.push({ side: 'before', path: c.before.path, line: c.before.line, note: `${c.before.key} ${c.guard}` });
    if (c.after) out.push({ side: 'after', path: c.after.path, line: c.after.line, note: `${c.after.key}${c.replacement ? ` ${c.replacement}` : ''}` });
    return out;
}

export const guardRemoved: DeltaRule = {
    id: 'guard-removed',
    version: 1,
    dimension: 'security',
    reads: ['content'],
    derive(input) {
        const after = routeDelta(input).guards.filter((c) => c.kind === 'removed').map((c) => heuristicFinding(
            ruleIdentity(guardRemoved, 'route', `${c.path}#${c.key}#${c.guard}`, { members: [c.path] }),
            'error',
            { route: c.key, guard: c.guard, via: c.via, file: c.path, ...(c.before && c.before.key !== c.key ? { from: c.before.key } : {}) },
            guardEvidence(c),
        ));
        return { before: [], after };
    },
};

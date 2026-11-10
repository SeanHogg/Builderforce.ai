/**
 * rules/entryAdded.ts — `entry-added` (security, warn; C5.1): a route registration, VS Code command or
 * webview message handler the before side of the file did not have (and that is not a `guard-removed`
 * re-key or unguarded-sibling case). Params carry the route key, its kind and its guard count.
 *
 * Heuristic: text-level route facts; WS4 tree-sitter entry-point facts replace them.
 */

import type { DeltaRule } from '../contract.js';
import { heuristicFinding, ruleIdentity } from './support/identity.js';
import { routeDelta } from './support/routeDelta.js';

export const entryAdded: DeltaRule = {
    id: 'entry-added',
    version: 1,
    dimension: 'security',
    reads: ['content'],
    derive(input) {
        const after = routeDelta(input).added.map((c) => heuristicFinding(
            ruleIdentity(entryAdded, 'route', `${c.path}#${c.route.key}`, { members: [c.path] }),
            'warn',
            { route: c.route.key, kind: c.route.kind, guards: c.route.guards.length, file: c.path },
            [{ side: 'after', path: c.sidePath, line: c.route.line, note: c.route.key }],
        ));
        return { before: [], after };
    },
};

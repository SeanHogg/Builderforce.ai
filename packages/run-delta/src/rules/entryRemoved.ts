/**
 * rules/entryRemoved.ts — `entry-removed` (security, info; C5.1): a route registration, VS Code
 * command or webview message handler the after side of the file no longer has (attack surface shrank),
 * and that did not re-appear under a new key with the same handler.
 *
 * Heuristic: text-level route facts; WS4 tree-sitter entry-point facts replace them.
 */

import type { DeltaRule } from '../contract.js';
import { heuristicFinding, ruleIdentity } from './support/identity.js';
import { routeDelta } from './support/routeDelta.js';

export const entryRemoved: DeltaRule = {
    id: 'entry-removed',
    version: 1,
    dimension: 'security',
    reads: ['content'],
    derive(input) {
        const after = routeDelta(input).removed.map((c) => heuristicFinding(
            ruleIdentity(entryRemoved, 'route', `${c.path}#${c.route.key}`, { members: [c.path] }),
            'info',
            { route: c.route.key, kind: c.route.kind, file: c.path },
            [{ side: 'before', path: c.sidePath, line: c.route.line, note: c.route.key }],
        ));
        return { before: [], after };
    },
};

/**
 * rules/entryAdded.ts — `entry-added` (security, warn; C5.1): a route registration, VS Code command or
 * webview message handler the before side of the file did not have (and that is not a `guard-removed`
 * re-key, unguarded-sibling or method-widened case). Params carry the route key, its kind, its guard
 * count and its C5.7 STRIDE checklist (`stride-<category>`: the covering guard, or `uncovered`).
 *
 * Heuristic: text-level route facts; WS4 tree-sitter entry-point facts replace them.
 */

import type { DeltaRule } from '../contract.js';
import { filePairs } from './support/files.js';
import { heuristicFinding, ruleIdentity } from './support/identity.js';
import { routeDelta } from './support/routeDelta.js';
import { routeCoverage } from './support/routeInputs.js';
import { strideCoverageOf, strideRows } from './support/strideRows.js';

export const entryAdded: DeltaRule = {
    id: 'entry-added',
    version: 1,
    dimension: 'security',
    reads: ['content'],
    derive(input) {
        const coverage = strideCoverageOf(input);
        const views = new Map(filePairs(input).map((p) => [p.path, p.after]));
        const after = routeDelta(input).added.map((c) => {
            const view = views.get(c.path);
            // C5.7: the new entry point's STRIDE checklist, filled from its chain.
            const rows = view ? strideRows(routeCoverage(view, c.route, coverage), coverage) : {};
            return heuristicFinding(
                ruleIdentity(entryAdded, 'route', `${c.path}#${c.route.key}`, { members: [c.path] }),
                'warn',
                { route: c.route.key, kind: c.route.kind, guards: c.route.guards.length, file: c.path, ...rows },
                [{ side: 'after', path: c.sidePath, line: c.route.line, note: c.route.key }],
            );
        });
        return { before: [], after };
    },
};

/**
 * rules/methodWidened.ts — `method-widened` (security, warn; C5.1): an HTTP path the before side already
 * served now accepts another method (`GET /x` gains `ALL /x` or `POST /x`). Reported instead of
 * `entry-added` for that route. Params: the new route key, the methods it had (`from`) and its C5.7
 * STRIDE checklist (`stride-<category>`), as for a new entry point.
 *
 * Text route facts, or comparable FileFacts when the host supplied them (`support/factRoutes.ts`).
 */

import type { DeltaRule } from '../contract.js';
import { filePairs } from './support/files.js';
import { heuristicFinding, ruleIdentity } from './support/identity.js';
import { routeDelta } from './support/routeDelta.js';
import { routeCoverage } from './support/routeInputs.js';
import { strideCoverageOf, strideRows } from './support/strideRows.js';

export const methodWidened: DeltaRule = {
    id: 'method-widened',
    version: 1,
    dimension: 'security',
    reads: ['content'],
    derive(input) {
        const coverage = strideCoverageOf(input);
        const views = new Map(filePairs(input).map((p) => [p.path, p.after]));
        const after = routeDelta(input).widened.map((c) => {
            const view = views.get(c.path);
            const rows = view ? strideRows(routeCoverage(view, c.route, coverage), coverage) : {};
            return heuristicFinding(
                ruleIdentity(methodWidened, 'route', `${c.path}#${c.route.key}`, { members: [c.path] }),
                'warn',
                { route: c.route.key, from: c.from.join(', '), guards: c.route.guards.length, file: c.path, ...rows },
                [{ side: 'after', path: c.sidePath, line: c.route.line, note: c.route.key }],
            );
        });
        return { before: [], after };
    },
};

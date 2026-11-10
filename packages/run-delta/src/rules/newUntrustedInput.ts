/**
 * rules/newUntrustedInput.ts — `new-untrusted-input` (security, warn; C5.1): an entry point present on
 * BOTH sides of a changed file starts reading an untrusted input (a registry taint source: request body,
 * query, params, headers, webview message data, …) it did not read before. A brand-new route's inputs are
 * part of its `entry-added`, not this rule. Params: the route key, the source kind and the accessor.
 *
 * Heuristic: sources found inline in the route's registration call; WS4 `EntryPointFact.inputs` (which
 * follow a handler passed by name) replace the scan.
 */

import type { DeltaRule, RuleFinding } from '../contract.js';
import { filePairs, isCodePath, isTestPath } from './support/files.js';
import { heuristicFinding, ruleIdentity } from './support/identity.js';
import { routeInputs } from './support/routeInputs.js';
import { pairRoutes } from './support/factRoutes.js';
import { taintRegistryOf } from './support/taint.js';

export const newUntrustedInput: DeltaRule = {
    id: 'new-untrusted-input',
    version: 1,
    dimension: 'security',
    reads: ['content'],
    derive(input) {
        const reg = taintRegistryOf(input);
        const after: RuleFinding[] = [];
        for (const pair of filePairs(input)) {
            if (!pair.before || !pair.after || !isCodePath(pair.path) || isTestPath(pair.path)) continue;
            const routes = pairRoutes(input, pair);
            const before = new Map(routes.before.map((r) => [r.key, r]));
            for (const route of routes.after) {
                const prev = before.get(route.key);
                if (!prev || route.kind === 'middleware') continue;
                const had = new Set(routeInputs(pair.before, prev, reg).map((i) => i.entry));
                for (const i of routeInputs(pair.after, route, reg)) {
                    if (had.has(i.entry)) continue;
                    after.push(heuristicFinding(
                        ruleIdentity(newUntrustedInput, 'route', `${pair.path}#${route.key}#${i.entry}`, { members: [pair.path] }),
                        'warn',
                        { route: route.key, source: i.kind, call: i.entry, file: pair.path },
                        [
                            { side: 'before', path: pair.before.sidePath, line: prev.line, note: prev.key },
                            { side: 'after', path: pair.after.sidePath, line: route.line, note: i.entry },
                        ],
                    ));
                }
            }
        }
        return { before: [], after };
    },
};

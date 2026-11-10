/**
 * rules/apiBreaking.ts — `api-breaking` (ilities.compatibility, error; C7): an exported function,
 * const, class, interface, type or enum of a changed JS/TS file whose normalized declaration changed
 * or vanished (an interface/enum losing or changing a member counts; gaining one does not).
 *
 * Heuristic: text-level export facts, without the package `exports`-map semver rule; WS4 tree-sitter
 * export facts replace them.
 */

import type { DeltaRule, Evidence } from '../contract.js';
import { apiChanges } from './support/apiDiff.js';
import { heuristicFinding, ruleIdentity } from './support/identity.js';

export const apiBreaking: DeltaRule = {
    id: 'api-breaking',
    version: 1,
    dimension: 'ilities.compatibility',
    reads: ['content'],
    derive(input) {
        const after = apiChanges(input).filter((c) => c.change !== 'added').map((c) => {
            const evidence: Evidence[] = [];
            if (c.before) evidence.push({ side: 'before', path: c.before.path, line: c.before.line, snippet: c.before.signature.slice(0, 200), note: c.name });
            if (c.after) evidence.push({ side: 'after', path: c.after.path, line: c.after.line, snippet: c.after.signature.slice(0, 200), note: c.name });
            return heuristicFinding(
                ruleIdentity(apiBreaking, 'symbol', `${c.path}#${c.name}`, { members: [c.path], snippet: c.after?.signature ?? '' }),
                'error',
                { symbol: c.name, change: c.change, file: c.path },
                evidence,
            );
        });
        return { before: [], after };
    },
};

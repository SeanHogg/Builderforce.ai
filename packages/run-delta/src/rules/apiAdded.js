/**
 * rules/apiAdded.ts — `api-added` (ilities.compatibility, info; C7): a changed JS/TS file exports a
 * name it did not export before.
 *
 * Heuristic: text-level export facts; WS4 tree-sitter export facts replace them.
 */
import { apiChanges } from './support/apiDiff.js';
import { heuristicFinding, ruleIdentity } from './support/identity.js';
export const apiAdded = {
    id: 'api-added',
    version: 1,
    dimension: 'ilities.compatibility',
    reads: ['content'],
    derive(input) {
        const after = apiChanges(input).filter((c) => c.change === 'added' && c.after).map((c) => heuristicFinding(ruleIdentity(apiAdded, 'symbol', `${c.path}#${c.name}`, { members: [c.path] }), 'info', { symbol: c.name, file: c.path }, [{ side: 'after', path: c.after.path, line: c.after.line, snippet: c.after.signature.slice(0, 200), note: c.name }]));
        return { before: [], after };
    },
};
//# sourceMappingURL=apiAdded.js.map
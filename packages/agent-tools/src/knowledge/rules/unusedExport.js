/**
 * knowledge/rules/unusedExport.ts — `unused-export`: one finding per export knip badged unused, anchored on
 * `<file>#<name>` (PRD 41 §C3). Reads the knowledge input only. Request key `knowledgeGraph.fix.unusedExport`.
 */
import { defineRule } from '@seanhogg/builderforce-memory/knowledge';
import { CODE_BADGES } from '../codeNodes.js';
import { codeFiles, itemFindings } from './unusedItems.js';
const ITEM = { kind: 'unused-export', names: CODE_BADGES.unusedExportNames, count: CODE_BADGES.unusedExports, anchorKind: 'symbol' };
export const unusedExportRule = defineRule({
    id: 'code.unused-export',
    version: 1,
    reads: [], // the knowledge graph only
    scope: 'global',
    extraInputs: ['knowledge'],
    derive: ({ extra: { knowledge: k } }) => codeFiles(k.graph).flatMap((n) => itemFindings(n, ITEM)),
});
//# sourceMappingURL=unusedExport.js.map
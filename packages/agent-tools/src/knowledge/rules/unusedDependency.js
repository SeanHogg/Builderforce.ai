/**
 * knowledge/rules/unusedDependency.ts — `unused-dependency`: one finding per dependency knip badged unused, anchored on
 * `<manifest>#<name>` (PRD 41 §C3). Reads the knowledge input only. Request key `knowledgeGraph.fix.unusedDependency`.
 */
import { defineRule } from '@seanhogg/builderforce-memory/knowledge';
import { CODE_BADGES } from '../codeNodes.js';
import { codeFiles, itemFindings } from './unusedItems.js';
const ITEM = { kind: 'unused-dependency', names: CODE_BADGES.unusedDependencyNames, count: CODE_BADGES.unusedDependencies, anchorKind: 'package' };
export const unusedDependencyRule = defineRule({
    id: 'code.unused-dependency',
    version: 1,
    reads: [], // the knowledge graph only
    scope: 'global',
    extraInputs: ['knowledge'],
    derive: ({ extra: { knowledge: k } }) => codeFiles(k.graph).flatMap((n) => itemFindings(n, ITEM)),
});
//# sourceMappingURL=unusedDependency.js.map
/**
 * rules/snapshotUpdatedWithImpl.ts — `snapshot-updated-with-impl` (quality, warn; C8.2): a snapshot file
 * (`*.snap`, `__snapshots__/`) that existed before was rewritten in a run that also changed
 * implementation code — the expected output moved with the code under test.
 *
 * Heuristic: file-level; WS4 tree-sitter `testFacts` (snapshot files touched) replace it.
 */

import type { DeltaRule, RuleFinding } from '../contract.js';
import { filePairs, implChanged, isSnapshotPath } from './support/files.js';
import { heuristicFinding, ruleIdentity } from './support/identity.js';

export const snapshotUpdatedWithImpl: DeltaRule = {
    id: 'snapshot-updated-with-impl',
    version: 1,
    dimension: 'quality',
    reads: ['content'],
    derive(input) {
        const after: RuleFinding[] = [];
        if (!implChanged(input)) return { before: [], after };
        for (const p of filePairs(input)) {
            if (!isSnapshotPath(p.path) || !p.before || !p.after || p.before.text === p.after.text) continue;
            after.push(heuristicFinding(
                ruleIdentity(snapshotUpdatedWithImpl, 'file', p.path, { members: [p.path] }),
                'warn',
                { file: p.path },
                [{ side: 'before', path: p.before.path }, { side: 'after', path: p.after.path }],
            ));
        }
        return { before: [], after };
    },
};

/**
 * rules/godFileGrowth.ts — `god-file-growth` (ilities.maintainability, warn; C7 analysability): a
 * changed code file over {@link GOD_FILE_LINES} lines grew, or a file crossed that line (a new file
 * born over it included).
 *
 * Heuristic: line counts of the normalized text; WS4 structure facts (`lines` badge) replace it.
 */

import type { DeltaRule, Evidence, RuleFinding } from '../contract.js';
import { lineCount } from '../engine/text.js';
import { filePairs, isCodePath } from './support/files.js';
import { heuristicFinding, ruleIdentity } from './support/identity.js';

export const GOD_FILE_LINES = 400;

export const godFileGrowth: DeltaRule = {
    id: 'god-file-growth',
    version: 1,
    dimension: 'ilities.maintainability',
    reads: ['content'],
    derive(input) {
        const after: RuleFinding[] = [];
        for (const p of filePairs(input)) {
            if (!p.after || !isCodePath(p.path)) continue;
            const b = p.before ? lineCount(p.before.text) : 0, a = lineCount(p.after.text);
            if (a <= b || a <= GOD_FILE_LINES) continue;
            const evidence: Evidence[] = [{ side: 'after', path: p.after.path, note: String(a) }];
            if (p.before) evidence.push({ side: 'before', path: p.before.path, note: String(b) });
            after.push(heuristicFinding(
                ruleIdentity(godFileGrowth, 'file', p.path, { members: [p.path] }),
                'warn',
                { file: p.path, before: b, after: a, crossed: b <= GOD_FILE_LINES ? 1 : 0 },
                evidence,
            ));
        }
        return { before: [], after };
    },
};

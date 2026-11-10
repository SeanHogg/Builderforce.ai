/**
 * rules/rmRf.ts — `rm-rf` (ilities.safety, warn; C7): a recursive forced delete in a changed script —
 * `rm -rf` / `rm -fr` (any flag order), or PowerShell `Remove-Item -Recurse -Force`.
 *
 * Heuristic: text-level; WS4 call facts replace it.
 */

import type { DeltaRule } from '../contract.js';
import { isScriptPath } from './support/scripts.js';
import { regexHits, stateSides } from './support/stateRule.js';

const RM_RF = /\brm\s+-(?:[a-zA-Z]*r[a-zA-Z]*f|[a-zA-Z]*f[a-zA-Z]*r)[a-zA-Z]*\b|\bRemove-Item\b[^\n]*-Recurse\b[^\n]*-Force\b|\bRemove-Item\b[^\n]*-Force\b[^\n]*-Recurse\b/gi;

export const rmRf: DeltaRule = {
    id: 'rm-rf',
    version: 1,
    dimension: 'ilities.safety',
    reads: ['content'],
    derive(input) {
        return stateSides(rmRf, {
            files: isScriptPath,
            hits: (view) => regexHits(RM_RF, view.text).map(({ offset, match }) => ({ offset, length: match[0].length, key: 'rm-rf' })),
            severity: 'warn',
        }, input);
    },
};

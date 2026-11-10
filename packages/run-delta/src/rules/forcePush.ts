/**
 * rules/forcePush.ts — `force-push` (ilities.safety, warn; C7): `git push --force` / `-f` /
 * `--force-with-lease` (or a `+refspec`) in a changed script.
 *
 * Heuristic: text-level; WS4 call facts replace it.
 */

import type { DeltaRule } from '../contract.js';
import { isScriptPath } from './support/scripts.js';
import { regexOffsets, stateSides } from './support/stateRule.js';

const FORCE_PUSH = /\bgit\s+push\b[^\n;&|]*?(?:\s--force(?:-with-lease)?\b|\s-f\b|\s\+[\w/.-]+)/g;

export const forcePush: DeltaRule = {
    id: 'force-push',
    version: 1,
    dimension: 'ilities.safety',
    reads: ['content'],
    derive(input) {
        return stateSides(forcePush, {
            files: isScriptPath,
            hits: (text) => regexOffsets(FORCE_PUSH, text).map(({ offset }) => ({ offset, key: 'git-push-force' })),
            severity: 'warn',
        }, input);
    },
};

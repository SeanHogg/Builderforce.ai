/**
 * rules/weakCrypto.ts — `weak-crypto` (security, error; C5.3): a registry weak-crypto pattern (md5 /
 * sha1 hashing, ECB mode, `Math.random` near a token/secret/password) in a changed file, matched over
 * comment-masked source (strings stay, since the algorithm name is a string).
 *
 * Heuristic: text-level; WS4 tree-sitter crypto-primitive facts replace it.
 */

import type { DeltaRule } from '../contract.js';
import { isCodePath, isTestPath, masked, squash } from './support/files.js';
import { regexOffsets, stateSides } from './support/stateRule.js';

export const weakCrypto: DeltaRule = {
    id: 'weak-crypto',
    version: 1,
    dimension: 'security',
    reads: ['content'],
    derive(input) {
        return stateSides(weakCrypto, {
            files: (p) => isCodePath(p) && !isTestPath(p),
            hits: (text, path) => {
                const { code } = masked(text, path);
                return input.registries.weakCrypto.flatMap((source) => regexOffsets(source, code, 'gi')
                    .map(({ offset, match }) => ({ offset, key: squash(match[0]).toLowerCase().slice(0, 60) })));
            },
            severity: 'error',
        }, input);
    },
};

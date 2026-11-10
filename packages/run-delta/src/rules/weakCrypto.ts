/**
 * rules/weakCrypto.ts — `weak-crypto` (security, error; C5.3): a registry weak-crypto pattern (md5 /
 * sha1 hashing, ECB mode, `Math.random` near a token/secret/password) in a changed file, matched over
 * comment-masked source (strings stay, since the algorithm name is a string). The registry regexes are
 * repo-overridable, so they run line by line on capped lines; the key and the anchor are redacted.
 *
 * Heuristic: text-level; WS4 tree-sitter crypto-primitive facts replace it.
 */

import type { DeltaRule } from '../contract.js';
import { isCodePath, isTestPath, squash } from './support/files.js';
import { perLineHits, stateSides } from './support/stateRule.js';

export const weakCrypto: DeltaRule = {
    id: 'weak-crypto',
    version: 1,
    dimension: 'security',
    reads: ['content'],
    derive(input) {
        const patterns = input.registries.weakCrypto.map((s) => new RegExp(s, 'gi'));
        return stateSides(weakCrypto, {
            files: (p) => isCodePath(p) && !isTestPath(p),
            hits: (view) => perLineHits(patterns, view.code)
                .map(({ offset, match }) => ({ offset, length: match[0].length, key: squash(match[0]).toLowerCase().slice(0, 60) })),
            severity: 'error',
        }, input);
    },
};

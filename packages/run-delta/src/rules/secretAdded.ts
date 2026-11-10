/**
 * rules/secretAdded.ts — `secret-added` (security, error; C5.5): a recognisable credential shape in a
 * changed file, using THE secret pattern list (`@builderforce/secret-redaction` `SECRET_SHAPES`, the
 * provider-prefix tokens and PEM blocks; never a copy). Like every state rule, the span and the line are
 * redacted before they reach an anchor, a param or evidence, so no finding carries the secret.
 *
 * Heuristic: text-level over the whole changed file; the gitleaks adapter (L3, changed hunks) replaces
 * it as the measured source.
 */

import { SECRET_SHAPES } from '@builderforce/secret-redaction';
import type { DeltaRule } from '../contract.js';
import { isSnapshotPath, type TextView } from './support/files.js';
import { regexHits, stateSides, type Hit } from './support/stateRule.js';

function hitsOf(view: TextView): Hit[] {
    const hits: Hit[] = [];
    for (const shape of SECRET_SHAPES) {
        for (const { offset, match } of regexHits(shape.re, view.text)) hits.push({ offset, length: Math.min(match[0].length, 120), key: shape.id });
    }
    return hits;
}

export const secretAdded: DeltaRule = {
    id: 'secret-added',
    version: 1,
    dimension: 'security',
    reads: ['content'],
    derive(input) {
        return stateSides(secretAdded, { files: (p) => !isSnapshotPath(p), hits: hitsOf, severity: 'error' }, input);
    },
};

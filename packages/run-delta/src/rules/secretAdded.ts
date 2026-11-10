/**
 * rules/secretAdded.ts — `secret-added` (security, error; C5.5): a recognisable credential shape in a
 * changed file, using THE secret pattern list (`@builderforce/secret-redaction` `SECRET_SHAPES`, the
 * provider-prefix tokens and PEM blocks; never a copy). The line is ALWAYS redacted (`redactText`)
 * before it enters an anchor, a param or evidence, so no finding carries the secret or a hash of it.
 *
 * Heuristic: text-level over the whole changed file; the gitleaks adapter (L3, changed hunks) replaces
 * it as the measured source.
 */

import { redactText, SECRET_SHAPES } from '@builderforce/secret-redaction';
import type { DeltaRule } from '../contract.js';
import { isSnapshotPath } from './support/files.js';
import { regexOffsets, stateSides, type Hit } from './support/stateRule.js';

function hitsOf(text: string): Hit[] {
    const hits: Hit[] = [];
    for (const shape of SECRET_SHAPES) {
        for (const { offset } of regexOffsets(shape.re, text)) hits.push({ offset, key: shape.id });
    }
    return hits;
}

export const secretAdded: DeltaRule = {
    id: 'secret-added',
    version: 1,
    dimension: 'security',
    reads: ['content'],
    derive(input) {
        return stateSides(secretAdded, {
            files: (p) => !isSnapshotPath(p),
            hits: (text) => hitsOf(text),
            severity: 'error',
            redact: (line) => redactText(line),
        }, input);
    },
};

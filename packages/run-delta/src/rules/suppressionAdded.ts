/**
 * rules/suppressionAdded.ts — `suppression-added` (quality, warn; C8.2): a registry suppression marker
 * (`@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `# noqa`, `as any`, …) in a changed code file,
 * tests and implementation alike (an agent can silence the checker in either). Matched on the raw text,
 * since most markers live in comments.
 *
 * Heuristic: text-level; WS4 tree-sitter comment/cast facts replace it.
 */

import type { DeltaRule } from '../contract.js';
import { escapeRegex, isCodePath } from './support/files.js';
import { cappedHits, stateSides, type Hit } from './support/stateRule.js';

function markerRegex(marker: string): RegExp {
    const edge = (c: string | undefined) => (c && /\w/.test(c) ? '\\b' : '');
    return new RegExp(`${edge(marker[0])}${escapeRegex(marker).replace(/\s+/g, '\\s+')}${edge(marker[marker.length - 1])}`, 'g');
}

export const suppressionAdded: DeltaRule = {
    id: 'suppression-added',
    version: 1,
    dimension: 'quality',
    reads: ['content'],
    derive(input) {
        const markers = input.registries.suppressions.map((m) => ({ m, re: markerRegex(m) }));
        return stateSides(suppressionAdded, {
            files: isCodePath,
            // Capped: past MAX_HITS_PER_KEY a marker aggregates, so the rest are only counted.
            hits: (view): Hit[] => markers.flatMap(({ m, re }) => cappedHits(re, view.text, m)),
            severity: 'warn',
        }, input);
    },
};

/**
 * rules/suppressionAdded.ts — `suppression-added` (quality, warn; C8.2): a registry suppression marker
 * (`@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `# noqa`, `as any`, …) on a line of a changed
 * code file, tests and implementation alike (an agent can silence the checker in either). Matched on
 * the raw text, since most markers live in comments.
 *
 * Heuristic: text-level; WS4 tree-sitter comment/cast facts replace it.
 */

import type { DeltaRule } from '../contract.js';
import { isCodePath } from './support/files.js';
import { regexOffsets, stateSides, type Hit } from './support/stateRule.js';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function hitsOf(text: string, markers: readonly string[]): Hit[] {
    return markers.flatMap((marker) => {
        const edge = (c: string | undefined) => (c && /\w/.test(c) ? '\\b' : '');
        const re = `${edge(marker[0])}${escapeRe(marker).replace(/\s+/g, '\\s+')}${edge(marker[marker.length - 1])}`;
        return regexOffsets(re, text).map(({ offset }) => ({ offset, key: marker }));
    });
}

export const suppressionAdded: DeltaRule = {
    id: 'suppression-added',
    version: 1,
    dimension: 'quality',
    reads: ['content'],
    derive(input) {
        return stateSides(suppressionAdded, {
            files: isCodePath,
            hits: (text) => hitsOf(text, input.registries.suppressions),
            severity: 'warn',
        }, input);
    },
};

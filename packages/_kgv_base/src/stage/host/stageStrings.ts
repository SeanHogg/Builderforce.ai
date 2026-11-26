/**
 * The words a placement embeds (partition and community names, band titles, the row cameras' plane captions, the mind
 * map's and the Sequence's words), localized by the host and handed to the worker with the MarkSet request: the stage
 * never supplies English of its own.
 */

import { useMemo } from 'react';
import { PLACEMENT_WORD_KEYS } from '../../compute/tasks/placement/graph';
import { cameraStrings } from '../../compute/tasks/placement/cameraStrings';
import { MIND_WORD_KEYS } from '../../compute/tasks/placement/mindmap';
import { SEQUENCE_WORD_KEYS } from '../../compute/tasks/placement/sequence';
import type { KnowledgeGraphLabels } from '../../labels';
import { bandStrings } from '../../surface/bands';

/** A catalog word by its dotted key (`mapMore`, `mind.moreFoldersOne`, `sequence.hop`): top level first, then `surface`. */
export function labelAt(labels: KnowledgeGraphLabels, key: string): string {
    for (const root of [labels, labels.surface] as unknown[]) {
        let v: unknown = root;
        for (const part of key.split('.')) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[part] : undefined;
        if (typeof v === 'string') return v;
    }
    return '';
}

export function stageStrings(labels: KnowledgeGraphLabels): Record<string, string> {
    return {
        ...Object.fromEntries(PLACEMENT_WORD_KEYS.map((k) => [k, labels[k]])), ...bandStrings(labels), ...cameraStrings(labels),
        ...Object.fromEntries([...MIND_WORD_KEYS, ...SEQUENCE_WORD_KEYS].map((k) => [k, labelAt(labels, k)])),
    };
}

/** {@link stageStrings}, once per catalog. */
export const useStageStrings = (labels: KnowledgeGraphLabels): Record<string, string> => useMemo(() => stageStrings(labels), [labels]);

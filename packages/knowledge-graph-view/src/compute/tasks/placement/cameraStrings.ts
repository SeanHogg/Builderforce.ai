/**
 * The localized words the row cameras' placements (System, Heat, Style, Features) caption their planes with. The worker
 * has no labels object, so the main thread copies these into the markSet request's `strings` (beside `bandStrings`,
 * whose layer titles the same placements read) and the placements read them back by key. Every word is an EXISTING
 * catalog string — the DOM cameras' own headings — so the stage never supplies words of its own. A missing word reads
 * as empty, never as an invented English one.
 */

import type { KnowledgeGraphLabels } from '../../../labels';
import { FEATURE_GROUPS, type FeatureGroup } from '../../../surface/features/keyFeatures';
import { STYLE_IDS, type StyleId } from '../../../surface/style/architectureStyle';

/** The keys a placement reads; `systemMore` is a `{count}` template. */
export const CAMERA_WORD = {
    systemData: 'camera:system:data',
    systemLoose: 'camera:system:loose',
    more: 'camera:more',
    styleVerdict: 'camera:style:verdict',
    styleVerdictNone: 'camera:style:verdictNone',
} as const;

export const featureGroupKey = (g: FeatureGroup): string => `camera:features:${g}`;
export const styleNameKey = (id: StyleId): string => `camera:style:${id}`;

/** Main thread: the camera words as `strings` entries for the markSet request. */
export function cameraStrings(labels: KnowledgeGraphLabels): Record<string, string> {
    const s = labels.surface;
    return {
        [CAMERA_WORD.systemData]: s.system.data,
        [CAMERA_WORD.systemLoose]: s.systems.loose,
        [CAMERA_WORD.more]: s.system.more,
        [CAMERA_WORD.styleVerdict]: s.architectureStyle.verdict,
        [CAMERA_WORD.styleVerdictNone]: s.architectureStyle.verdictNone,
        ...Object.fromEntries(FEATURE_GROUPS.map((g) => [featureGroupKey(g), s.keyFeatures.groups[g]])),
        ...Object.fromEntries(STYLE_IDS.map((id) => [styleNameKey(id), s.architectureStyle.styles[id]])),
    };
}

/** Worker: a camera word from the request's `strings` ('' when the host sent none). */
export const wordIn = (strings: Readonly<Record<string, string>>, key: string): string => strings[key] ?? '';

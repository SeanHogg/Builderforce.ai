/**
 * What a map band is called and coloured, by its layer: an architecture layer (`surface/layers.ts`) or a drilled level's
 * band (`transit/drillView.ts`). Read by the transit map's bands, the System camera's tiers and the stage's station card,
 * so it lives with the layers, not with any one renderer. Pure.
 */

import type { KnowledgeGraphLabels } from '../labels';
import type { ThemeTone } from '../scene/themeColors';

/** The title colour of each band; the System camera's tier labels read the same table. */
export const BAND_TONE: Record<string, ThemeTone> = {
    entry: 'bandEntry', presentation: 'bandPresentation', application: 'bandApplication', domain: 'bandDomain',
    infrastructure: 'bandInfrastructure', symbol: 'nodeSymbol', methods: 'nodeFile', errors: 'nodeEntity', body: 'l2', callees: 'nodeFile', leaves: 'muted',
};

/** The key a band's title travels under in a worker task's `strings` table (the worker has no labels object). */
const bandKey = (layer: string): string => `band:${layer}`;

/** Every band's localized title as `strings` entries, for the markSet request (the Map placement's band captions read them). */
export function bandStrings(labels: KnowledgeGraphLabels): Record<string, string> {
    const s = labels.surface;
    const layers = [...Object.keys(s.layers), ...Object.keys(s.map.bands)];
    return Object.fromEntries(layers.map((layer) => [bandKey(layer), bandTitle(layer, labels)]));
}

/** A band's title from a `strings` table ({@link bandStrings}); the layer id only when the host sent none. Worker-safe. */
export const bandTitleIn = (strings: Readonly<Record<string, string>>, layer: string): string => strings[bandKey(layer)] ?? layer;

/** A band's title: an architecture layer's, else the drilled level's. */
export function bandTitle(layer: string, labels: KnowledgeGraphLabels): string {
    const s = labels.surface;
    return (s.layers as Record<string, string | undefined>)[layer] ?? (s.map.bands as Record<string, string | undefined>)[layer] ?? s.layers.other;
}

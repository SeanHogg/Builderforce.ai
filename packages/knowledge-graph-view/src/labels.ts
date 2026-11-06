/**
 * Every word the view shows, as ONE typed object with English defaults — the brain-ui
 * pattern (`SurfaceHeaderLabels`). Every host passes its `knowledgeGraph.*` catalog through
 * THE ONE mapper (`@builderforce/knowledge-browser` `knowledgeGraphLabels`; the web feeds it
 * next-intl's `t.raw`, Rovr the same five web catalogs), so this package hardcodes no
 * user-facing string outside these defaults.
 *
 * Templates use `{name}` placeholders and are filled by {@link fillTemplate} — never by
 * the host's i18n runtime, so a template's params are the finding's own and nothing
 * else (the Fix-with-agent requests are a FIXED list: never a model call).
 */

import { HEADER_DEFAULTS, type HeaderLabels } from './labels/surface.header';
import { MAP_DEFAULTS, type MapLabels } from './labels/surface.map';
import { ACT_DEFAULTS, type ActLabels } from './labels/surface.act';
import { SYNC_DEFAULTS, type SyncLabels } from './labels/surface.sync';
import { COVERAGE_DEFAULTS, type CoverageLabels } from './labels/surface.coverage';
import { PATTERNS_DEFAULTS, type PatternsLabels } from './labels/surface.patterns';
import { API_DEFAULTS, type ApiLabels } from './labels/surface.api';
import { RESOLVE_DEFAULTS, type ResolveLabels } from './labels/surface.resolve';
import { FIX_DEFAULTS, type FixLabels } from './labels/surface.fix';
import { CORE_DEFAULTS, type CoreLabels, type FindingKindLabels } from './labels/core';

export { camelKind, fillTemplate } from './template';
export type { FindingKindLabels };

/** The keys of `KnowledgeGraphLabels` that hold one string (a registry row names its label by one). */
export type StringLabelKey = { [K in keyof KnowledgeGraphLabels]: KnowledgeGraphLabels[K] extends string ? K : never }[keyof KnowledgeGraphLabels];

/** The words of the transit-map surface: the per-area modules under `labels/`, composed. */
export interface SurfaceLabels extends HeaderLabels, MapLabels, ActLabels, SyncLabels, CoverageLabels, PatternsLabels, ApiLabels, ResolveLabels, FixLabels {}

export interface KnowledgeGraphLabels extends CoreLabels {
    surface: SurfaceLabels;
}

const SURFACE_DEFAULTS: SurfaceLabels = {
    ...HEADER_DEFAULTS,
    ...MAP_DEFAULTS,
    ...ACT_DEFAULTS,
    ...SYNC_DEFAULTS,
    ...COVERAGE_DEFAULTS,
    ...PATTERNS_DEFAULTS,
    ...API_DEFAULTS,
    ...RESOLVE_DEFAULTS,
    ...FIX_DEFAULTS,
};

export const DEFAULT_KNOWLEDGE_GRAPH_LABELS: KnowledgeGraphLabels = {
    ...CORE_DEFAULTS,
    surface: SURFACE_DEFAULTS,
};

/** Host labels over the defaults, one level deep for the nested maps. */
export function resolveLabels(partial?: Partial<KnowledgeGraphLabels>): KnowledgeGraphLabels {
    if (!partial) return DEFAULT_KNOWLEDGE_GRAPH_LABELS;
    const d = DEFAULT_KNOWLEDGE_GRAPH_LABELS;
    return {
        ...d, ...partial,
        targets: { ...d.targets, ...partial.targets },
        lenses: { ...d.lenses, ...partial.lenses },
        lensHints: { ...d.lensHints, ...partial.lensHints },
        legend: { ...d.legend, ...partial.legend },
        metrics: { ...d.metrics, ...partial.metrics },
        edgeKinds: { ...d.edgeKinds, ...partial.edgeKinds },
        packs: { ...d.packs, ...partial.packs },
        findingKinds: { ...d.findingKinds, ...partial.findingKinds },
        severity: { ...d.severity, ...partial.severity },
        fix: { ...d.fix, ...partial.fix },
        origins: { ...d.origins, ...partial.origins },
        phases: { ...d.phases, ...partial.phases },
        surface: mergeSurface(d.surface, partial.surface),
    };
}

/** Host words over the defaults, down through nested maps (the fix and simulate words nest one more level). */
function mergeDeep(base: object, over: object | undefined): object {
    const out: Record<string, unknown> = { ...base, ...over };
    for (const [k, v] of Object.entries(base)) if (typeof v === 'object' && v !== null) out[k] = mergeDeep(v, (over as Record<string, object> | undefined)?.[k]);
    return out;
}

/** The surface words over the defaults. */
function mergeSurface(d: SurfaceLabels, partial?: Partial<SurfaceLabels>): SurfaceLabels {
    if (!partial) return d;
    const out: Record<string, unknown> = { ...d, ...partial };
    for (const key of Object.keys(d) as Array<keyof SurfaceLabels>) {
        const base = d[key];
        if (typeof base === 'object') out[key] = mergeDeep(base as object, partial[key] as object | undefined);
    }
    return out as unknown as SurfaceLabels;
}


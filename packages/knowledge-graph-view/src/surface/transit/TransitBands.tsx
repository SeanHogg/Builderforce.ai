/**
 * The map's backdrop: the layer bands with titles coloured per layer, and the HTTP boundary
 * walls. Decorative (`aria-hidden`); the stations carry the meaning.
 */

import type { KnowledgeGraphLabels } from '../../labels';
import { cssVar, type ThemeTone } from '../../scene/themeColors';
import type { Band } from '../transitLayout';
import type { Wall } from './wall';

const BAND_TONE: Record<string, ThemeTone> = {
    entry: 'bandEntry', presentation: 'bandPresentation', application: 'bandApplication', domain: 'bandDomain',
    infrastructure: 'bandInfrastructure', symbol: 'nodeSymbol', methods: 'nodeFile', errors: 'nodeEntity', body: 'l2', callees: 'nodeFile', leaves: 'muted',
};

/** A band's title: an architecture layer's, else the drilled level's. */
export function bandTitle(layer: string, labels: KnowledgeGraphLabels): string {
    const s = labels.surface;
    return (s.layers as Record<string, string | undefined>)[layer] ?? (s.map.bands as Record<string, string | undefined>)[layer] ?? s.layers.other;
}

export function TransitBands({ bands, width, walls, labels }: { bands: readonly Band[]; width: number; walls: readonly Wall[]; labels: KnowledgeGraphLabels }) {
    return (
        <>
            {bands.map((band, i) => (
                <g key={band.layer} aria-hidden="true" data-band={band.layer}>
                    <rect x={0} y={band.y} width={width} height={band.h} fill={i % 2 ? cssVar('plane') : 'transparent'} />
                    <text x={10} y={band.y + 16} fontSize={10} fontWeight={700} letterSpacing="0.08em" fill={cssVar(BAND_TONE[band.layer] ?? 'muted')}>
                        {bandTitle(band.layer, labels).toUpperCase()}
                    </text>
                </g>
            ))}
            {walls.map((w, i) => (
                <g key={i} aria-hidden="true" data-wall>
                    <line x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke={cssVar('muted')} strokeWidth={2.5} strokeDasharray="5 4" strokeLinecap="round" />
                    {i === 0 && <text x={w.label.x} y={w.label.y} fontSize={10} fontWeight={600} fill={cssVar('muted')} paintOrder="stroke" stroke={cssVar('bg')} strokeWidth={3}>{labels.surface.map.wall}</text>}
                </g>
            ))}
        </>
    );
}

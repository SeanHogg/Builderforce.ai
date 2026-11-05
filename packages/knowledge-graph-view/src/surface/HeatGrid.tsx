/**
 * The Heat camera (PRD 38, Option B+): one row per layer, one cell per station. A cell's size
 * is the size channel, its colour the colour channel and its bar the ring channel, all read
 * from the same overlay bindings as the transit map, so "Risk" paints every view alike. A
 * channel whose data is not set up draws a neutral cell, never a zero.
 */

import { useMemo } from 'react';
import { fillTemplate } from '../labels';
import { cssVar } from '../scene/themeColors';
import { muted, heading } from '../styles';
import { Bar } from './drawers/ui';
import type { SceneProps } from './registry';
import { NEUTRAL_SIZE } from './overlays';
import { buildTiers } from './tiers';

/** The cell's width from the marker radius the overlay gives (5 + 2 x level, or the neutral size). */
export const cellWidth = (size: number): number => 64 + (size - NEUTRAL_SIZE) * 10;

export function HeatGrid({ labels, surface }: SceneProps) {
    const s = labels.surface;
    const { stations, overlay, lit } = surface;
    const tiers = useMemo(() => buildTiers(stations.stations), [stations]);
    const layerName = (layer: string) => s.layers[layer as keyof typeof s.layers] ?? s.layers.other;
    if (stations.stations.length === 0) return <p style={{ ...muted, padding: 12 }}>{s.heat.empty}</p>;
    const b = overlay.bindings;

    return (
        <div data-testid="kg-heat" role="group" aria-label={labels.regionLabel} style={{ display: 'grid', gap: 12, padding: 12 }}>
            <p style={{ ...muted, margin: 0 }}>{fillTemplate(s.heat.description, { layers: tiers.length, components: stations.stations.length })}</p>
            <p style={{ ...muted, margin: 0 }}>{fillTemplate(s.heat.legend, { size: s.metricNames[b.size], colour: s.metricNames[b.colour], bar: s.metricNames[b.ring] })}</p>
            {tiers.map((tier) => (
                <section key={tier.layer} aria-label={layerName(tier.layer)} data-tier={tier.layer} style={{ display: 'grid', gap: 6 }}>
                    <h3 style={{ ...heading, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: cssVar('muted') }}>{layerName(tier.layer)}</h3>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'stretch' }}>
                        {tier.stations.map((st) => {
                            const style = overlay.style(st);
                            const dim = lit !== null && !lit.has(st.id);
                            const selected = surface.station?.id === st.id;
                            return (
                                <button
                                    key={st.id} type="button" data-cell={st.id} aria-pressed={selected}
                                    aria-label={fillTemplate(s.heat.cellAria, { name: st.name, files: st.files })}
                                    onClick={() => surface.selectStation(st.id)}
                                    style={{
                                        width: cellWidth(style.size), minHeight: 56, padding: 6, display: 'grid', gap: 4, alignContent: 'space-between', textAlign: 'start',
                                        font: 'inherit', fontSize: 11, cursor: 'pointer', borderRadius: 8, color: cssVar('text'), opacity: dim ? 0.35 : 1,
                                        border: `2px solid ${selected ? cssVar('accent') : cssVar('border')}`,
                                        background: `color-mix(in srgb, ${cssVar(style.tone)} 45%, ${cssVar('bg')})`,
                                    }}
                                >
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{st.name}</span>
                                    {style.ring && <Bar frac={style.ring.frac} tone={style.ring.tone} label={s.metricNames[b.ring]} height={4} />}
                                </button>
                            );
                        })}
                    </div>
                </section>
            ))}
        </div>
    );
}

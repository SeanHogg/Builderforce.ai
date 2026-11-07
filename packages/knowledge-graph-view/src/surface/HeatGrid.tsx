/**
 * The Heat camera (PRD 38, Option B+): one row per layer, one cell per station. A cell's size
 * is the size channel, its colour the colour channel and its bar the ring channel, all read
 * from the same overlay bindings as the transit map, so "Risk" paints every view alike. A
 * channel whose data is not set up draws a neutral cell, never a zero.
 */

import { useMemo, useState } from 'react';
import { fillTemplate } from '../labels';
import { counted } from './plural';
import { cssVar } from '../scene/themeColors';
import { muted } from '../styles';
import { TYPE } from './ui/type';
import { Bar } from './drawers/ui';
import type { SceneProps } from './registry';
import { NEUTRAL_SIZE } from './overlays';
import { buildTiers } from './tiers';

/** The cell's width from the marker radius the overlay gives (5 + 2 x level, or the neutral size). */
export const cellWidth = (size: number): number => 64 + (size - NEUTRAL_SIZE) * 10;

/** Cells drawn at once; "N more" reveals the next page, so a huge repo never mounts thousands of buttons. */
export const HEAT_CELL_CAP = 200;

export function HeatGrid({ labels, surface }: SceneProps) {
    const s = labels.surface;
    const { stations, overlay, lit } = surface;
    const [limit, setLimit] = useState(HEAT_CELL_CAP);
    const allTiers = useMemo(() => buildTiers(stations.stations), [stations]);
    const { tiers, hidden } = useMemo(() => {
        let budget = limit;
        const visible = allTiers.map((tier) => {
            const cells = tier.stations.slice(0, Math.max(0, budget));
            budget -= cells.length;
            return { ...tier, stations: cells };
        }).filter((tier) => tier.stations.length > 0);
        return { tiers: visible, hidden: Math.max(0, stations.stations.length - (limit - budget)) };
    }, [allTiers, limit, stations]);
    const layerName = (layer: string) => s.layers[layer as keyof typeof s.layers] ?? s.layers.other;
    if (stations.stations.length === 0) return <p style={{ ...muted, padding: 12 }}>{s.heat.empty}</p>;
    const b = overlay.bindings;

    return (
        <div data-testid="kg-heat" role="group" aria-label={labels.regionLabel} style={{ display: 'grid', gap: 12, padding: 12 }}>
            <p style={{ ...muted, margin: 0 }}>{fillTemplate(s.heat.description, { layers: counted(labels, 'layer', allTiers.length), components: counted(labels, 'component', stations.stations.length) })}</p>
            <p style={{ ...muted, margin: 0 }}>{fillTemplate(s.heat.legend, { size: s.metricNames[b.size], colour: s.metricNames[b.colour], bar: s.metricNames[b.ring] })}</p>
            {tiers.map((tier) => (
                <section key={tier.layer} aria-label={layerName(tier.layer)} data-tier={tier.layer} style={{ display: 'grid', gap: 6 }}>
                    <h3 style={TYPE.sectionHeading}>{layerName(tier.layer)}</h3>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'stretch' }}>
                        {tier.stations.map((st) => {
                            const style = overlay.style(st);
                            const dim = lit !== null && !lit.has(st.id);
                            const selected = surface.station?.id === st.id;
                            return (
                                <button
                                    key={st.id} type="button" data-cell={st.id} aria-pressed={selected}
                                    aria-label={fillTemplate(s.heat.cellAria, { name: st.name, files: counted(labels, 'file', st.files) })}
                                    onClick={() => surface.selectStation(st.id)}
                                    style={{
                                        width: cellWidth(style.size), minHeight: 56, padding: 6, display: 'grid', gap: 4, alignContent: 'space-between', textAlign: 'start',
                                        font: 'inherit', ...TYPE.meta, color: cssVar('text'), cursor: 'pointer', borderRadius: 8, opacity: dim ? 0.35 : 1,
                                        border: `2px solid ${selected ? cssVar('accent') : cssVar('border')}`,
                                        background: `color-mix(in srgb, ${cssVar(style.tone)} 45%, ${cssVar('bg')})`,
                                    }}
                                >
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...TYPE.monoName }}>{st.name}</span>
                                    {style.ring && <Bar frac={style.ring.frac} tone={style.ring.tone} label={s.metricNames[b.ring]} height={4} />}
                                </button>
                            );
                        })}
                    </div>
                </section>
            ))}
            {hidden > 0 && (
                <button type="button" data-heat-more onClick={() => setLimit((n) => n + HEAT_CELL_CAP)} style={{ ...muted, justifySelf: 'start', font: 'inherit', ...TYPE.bodyMuted, cursor: 'pointer', background: 'transparent', border: `1px solid ${cssVar('border')}`, borderRadius: 8, padding: '6px 10px' }}>
                    {fillTemplate(s.heat.showMore, { count: hidden })}
                </button>
            )}
        </div>
    );
}

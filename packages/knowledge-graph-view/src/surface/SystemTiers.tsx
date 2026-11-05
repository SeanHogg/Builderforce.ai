/**
 * The System camera (PRD 38, Option B+): the stations as N tiers, one row per layer. A
 * component card carries its name, the stacked anti-pattern bar (its findings by kind) and the
 * ring-channel bar; the data stores and external services the lines end in sit in a row of
 * their own. Colours come from the overlay bindings, like every camera.
 */

import { useMemo } from 'react';
import { findingTitle } from '../findingText';
import { fillTemplate } from '../labels';
import { cmp } from '../order';
import { cssVar, type ThemeTone } from '../scene/themeColors';
import { card, heading, muted } from '../styles';
import { Bar } from './drawers/ui';
import type { SceneProps } from './registry';
import { buildTiers, findingKinds, termini } from './tiers';

const KIND_TONES: readonly ThemeTone[] = ['violation', 'cycle', 'duplicate', 'contradicts', 'changed', 'nodeSymbol', 'nodeEntity', 'unused'];

const cardButton = (selected: boolean, dim: boolean) => ({
    ...card, display: 'grid', gap: 6, textAlign: 'start', cursor: 'pointer', font: 'inherit', color: cssVar('text'), minWidth: 0,
    borderColor: selected ? cssVar('accent') : cssVar('border'), opacity: dim ? 0.4 : 1,
} as const);

export function SystemTiers({ graph, labels, surface }: SceneProps) {
    const s = labels.surface;
    const { stations, overlay, lines, lit } = surface;
    const tiers = useMemo(() => buildTiers(stations.stations), [stations]);
    const byFinding = useMemo(() => new Map(graph.findings.map((f) => [f.id, f] as const)), [graph.findings]);
    const kinds = useMemo(() => [...new Set(graph.findings.map((f) => f.kind))].sort(cmp), [graph.findings]);
    const ends = useMemo(() => termini(lines.lines), [lines.lines]);
    const layerName = (layer: string) => s.layers[layer as keyof typeof s.layers] ?? s.layers.other;
    const dim = (id: string) => lit !== null && !lit.has(id);
    if (stations.stations.length === 0) return <p style={{ ...muted, padding: 12 }}>{s.system.empty}</p>;

    return (
        <div data-testid="kg-system" role="group" aria-label={labels.regionLabel} style={{ display: 'grid', gap: 12, padding: 12 }}>
            <p style={{ ...muted, margin: 0 }}>{fillTemplate(s.system.description, { tiers: tiers.length, components: stations.stations.length })}</p>
            {kinds.length > 0 && (
                <ul aria-label={s.kindsLegend} data-testid="kg-system-legend" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 12 }}>
                    {kinds.map((kind) => (
                        <li key={kind} data-legend={kind} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 2, background: cssVar(KIND_TONES[kinds.indexOf(kind) % KIND_TONES.length]!) }} />
                            {findingTitle({ kind }, labels)}
                        </li>
                    ))}
                </ul>
            )}
            {tiers.map((tier) => (
                <section key={tier.layer} aria-label={layerName(tier.layer)} data-tier={tier.layer} style={{ display: 'grid', gap: 6 }}>
                    <h3 style={{ ...heading, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: cssVar('muted') }}>{layerName(tier.layer)}</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
                        {tier.stations.map((st) => {
                            const style = overlay.style(st);
                            const found = findingKinds(st, byFinding);
                            const total = found.reduce((n, k) => n + k.count, 0);
                            return (
                                <button
                                    key={st.id} type="button" data-component={st.id} aria-pressed={surface.station?.id === st.id}
                                    aria-label={fillTemplate(s.system.componentAria, { name: st.name, files: st.files, findings: total })}
                                    style={cardButton(surface.station?.id === st.id, dim(st.id))} onClick={() => surface.selectStation(st.id)}
                                >
                                    <strong style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{st.name}</strong>
                                    <span style={muted}>{fillTemplate(s.stationMeta, { files: st.files, layer: layerName(tier.layer) })}</span>
                                    <div role="img" aria-label={s.system.antiBar} style={{ display: 'flex', height: 6, borderRadius: 999, overflow: 'hidden', background: cssVar('plane') }}>
                                        {found.map((k) => (
                                            <span
                                                key={k.kind} data-kind={k.kind} title={`${findingTitle({ kind: k.kind }, labels)} · ${k.count}`}
                                                style={{ flex: k.count, background: cssVar(KIND_TONES[kinds.indexOf(k.kind) % KIND_TONES.length]!) }}
                                            />
                                        ))}
                                    </div>
                                    {found.length > 0 && <span data-testid="kg-kind-text" style={{ ...muted, fontSize: 11 }}>{found.map((k) => `${findingTitle({ kind: k.kind }, labels)} ×${k.count}`).join(' · ')}</span>}
                                    {style.ring
                                        ? <Bar frac={style.ring.frac} tone={style.ring.tone} label={s.metricNames[overlay.bindings.ring]} />
                                        : overlay.status.ring === 'not-set-up' && <span style={muted}>{s.metricNames[overlay.bindings.ring]}: {s.notSetUp}</span>}
                                </button>
                            );
                        })}
                    </div>
                </section>
            ))}
            <section aria-label={s.system.data} data-tier="data" style={{ display: 'grid', gap: 6 }}>
                <h3 style={{ ...heading, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: cssVar('muted') }}>{s.system.data}</h3>
                {ends.length === 0 ? <p style={{ ...muted, margin: 0 }}>{s.system.dataEmpty}</p> : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {ends.map((t) => {
                            const st = stations.byId.get(t.stationId);
                            return st && (
                                <button
                                    key={t.stationId} type="button" data-terminus={t.kind} style={{ ...cardButton(surface.station?.id === st.id, dim(st.id)), minHeight: 40 }}
                                    onClick={() => surface.selectStation(st.id)}
                                >
                                    <strong style={{ fontSize: 13 }}>{st.name}</strong>
                                    <span style={muted}>{s.terminus[t.kind]}</span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </section>
        </div>
    );
}

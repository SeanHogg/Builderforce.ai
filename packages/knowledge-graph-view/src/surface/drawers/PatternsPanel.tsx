/**
 * The Patterns drawer: a family-by-layer matrix from the `patterns` badge with the findings as
 * its Anti-pattern row, the families as a list (marked heuristic, because they are read from
 * names and imports), and the anti-patterns with *Resolve* and *Show in Tower*. Choosing a
 * family lights its stations through the "What patterns are here?" question.
 */

import { useMemo, useState } from 'react';
import { findingTitle } from '../../findingText';
import { fillTemplate } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { button, card, chip, muted } from '../../styles';
import { ProvenanceBadge } from '../ui';
import { findingProvenance } from '../scope';
import { stationOfRef } from '../stations';
import type { PanelProps } from '../registry';
import { patternMatrix, topAntiPatterns } from './patternsModel';
import { NotSetUp, Section } from './ui';

const cell = { textAlign: 'center', padding: '6px 8px', fontSize: 12, borderBottom: `1px solid ${cssVar('border')}` } as const;

export function PatternsPanel({ graph, labels, surface, onShow, onCamera, cameras }: PanelProps) {
    const s = labels.surface, t = s.patterns;
    const [active, setActive] = useState<{ family: string; stations: number } | null>(null);
    const matrix = useMemo(() => patternMatrix(graph, surface.stations), [graph, surface.stations]);
    if (matrix.families.length === 0 && matrix.antiTotal === 0) return <NotSetUp title={t.notSetUpTitle} body={t.notSetUpBody} />;
    const layerName = (layer: string) => s.layers[layer as keyof typeof s.layers] ?? s.layers.other;
    const light = (family: string, refs: string[]) => {
        surface.setFamily(family); // asks the patterns question, narrowed to this family (the scene's "{family} only" chip clears it)
        onShow(refs);
        setActive({ family, stations: new Set(refs.flatMap((r) => stationOfRef(surface.stations, r) ?? [])).size });
    };
    const tower = cameras?.includes('3d') === true;
    const antis = topAntiPatterns(graph.findings);

    return (
        <div data-testid="kg-patterns" style={{ display: 'grid', gap: 16 }}>
            <Section title={t.matrixTitle}>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                        <thead>
                            <tr>
                                <th scope="col" style={{ ...cell, textAlign: 'start' }} />
                                {matrix.layers.map((l) => <th key={l} scope="col" style={{ ...cell, color: cssVar('muted'), fontWeight: 600 }}>{layerName(l)}</th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {matrix.families.map((fam) => (
                                <tr key={fam.id}>
                                    <th scope="row" style={{ ...cell, textAlign: 'start' }}>
                                        <button type="button" data-family={fam.id} style={{ ...chip(false), minHeight: 32 }} onClick={() => light(fam.id, fam.refs)}>{fam.id}</button>
                                    </th>
                                    {matrix.layers.map((l) => {
                                        const n = fam.byLayer[l] ?? 0;
                                        return (
                                            <td key={l} style={{ ...cell, background: n ? `color-mix(in srgb, ${cssVar('accent')} ${Math.min(60, 15 + n * 10)}%, transparent)` : 'transparent' }} aria-label={fillTemplate(t.cellAria, { family: fam.id, layer: layerName(l), count: n })}>
                                                {n || ''}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                            <tr data-row="anti">
                                <th scope="row" style={{ ...cell, textAlign: 'start', color: cssVar('violation') }}>{t.antiRow}</th>
                                {matrix.layers.map((l) => {
                                    const n = matrix.anti[l] ?? 0;
                                    return (
                                        <td key={l} style={{ ...cell, background: n ? `color-mix(in srgb, ${cssVar('violation')} ${Math.min(60, 15 + n * 10)}%, transparent)` : 'transparent' }} aria-label={fillTemplate(t.cellAria, { family: t.antiRow, layer: layerName(l), count: n })}>
                                            {n || ''}
                                        </td>
                                    );
                                })}
                            </tr>
                        </tbody>
                    </table>
                </div>
            </Section>
            {active && <p role="status" data-testid="kg-patterns-lit" style={{ ...muted, margin: 0 }}>{fillTemplate(t.lights, { family: active.family, count: active.stations })}</p>}
            {matrix.families.length > 0 && (
                <Section title={t.listTitle}>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                        {matrix.families.map((fam) => (
                            <li key={fam.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                <strong style={{ fontSize: 13 }}>{fam.id}</strong>
                                <span style={muted}>{fillTemplate(t.listRow, { count: fam.refs.length })}</span>
                                <ProvenanceBadge provenance="heuristic" labels={labels} />
                            </li>
                        ))}
                    </ul>
                    <p style={{ ...muted, margin: 0 }}>{t.listHint}</p>
                </Section>
            )}
            <Section title={t.antiTitle}>
                {antis.length === 0 ? <p style={{ ...muted, margin: 0 }}>{t.antiNone}</p> : (
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                        {antis.map((f) => (
                            <li key={f.id} data-anti={f.id} style={{ ...card, display: 'grid', gap: 6 }}>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                    <strong style={{ fontSize: 13 }}>{findingTitle(f, labels)}</strong>
                                    <ProvenanceBadge provenance={findingProvenance(f)} labels={labels} />
                                </div>
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                    <button type="button" style={button} aria-label={fillTemplate(s.resolveFindingAria, { title: findingTitle(f, labels) })} onClick={() => surface.resolve(f)}>{t.resolve}</button>
                                    <button
                                        type="button" style={button} disabled={!tower}
                                        onClick={() => { onShow([...f.nodes]); onCamera?.('3d'); }}
                                    >
                                        {t.showInTower}
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </Section>
        </div>
    );
}

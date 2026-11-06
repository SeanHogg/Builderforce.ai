/**
 * The Coverage drawer: KPIs from the file badges, the complexity-against-coverage scatter and
 * the riskiest gaps. A folder with no coverage badge says "not set up"; it never shows 0%.
 * *Run with values* sends the person to Simulate on the gap's path; *Prompt tests* hands the
 * agent a fixed request for that file.
 */

import { useMemo } from 'react';
import { fillTemplate } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { button, card, muted } from '../../styles';
import { UNTESTED_BELOW } from '../../scene/channels';
import { coverageTone } from '../overlays';
import { stationOfRef } from '../stations';
import type { PanelProps } from '../registry';
import { coverageModel } from './coverageModel';
import { CoverageShape } from './CoverageShape';
import { ProvenanceBadge } from '../ui';
import { Kpi, kpiGrid, NotSetUp, Section, Unavailable } from './ui';

const W = 280, H = 170, PAD = 28;

const pct = (f: number): string => `${Math.round(f * 100)}%`;

export function CoveragePanel({ graph, labels, surface, onCompose }: PanelProps) {
    const t = labels.surface.coverage;
    const m = useMemo(() => coverageModel(graph), [graph]);
    if (m.withCoverage === 0) {
        return (
            <div data-testid="kg-coverage-empty" style={{ display: 'grid', gap: 16 }}>
                <NotSetUp title={t.notSetUpTitle} body={t.notSetUpBody} />
                <CoverageShape graph={graph} labels={labels} onCompose={onCompose} />
            </div>
        );
    }
    const prov = (p: 'deterministic' | 'heuristic' | 'runtime') => <ProvenanceBadge provenance={p} labels={labels} />;

    const x = (cx: number) => PAD + (m.maxComplexity > 0 ? cx / m.maxComplexity : 0) * (W - PAD - 8);
    const y = (cov: number) => H - PAD - cov * (H - PAD - 8);

    /** The path to drive for a file: its line when it is on one, else the file alone. */
    const simulate = (ref: string) => {
        const id = stationOfRef(surface.stations, ref);
        const line = id ? surface.lines.lines.find((l) => l.stops.includes(id)) : undefined;
        if (line) { surface.selectLine(line.id); if (id) surface.selectStation(id); } else surface.pinPath([ref]);
        surface.openPanel('simulate');
    };

    return (
        <div data-testid="kg-coverage" style={{ display: 'grid', gap: 16 }}>
            <div style={kpiGrid}>
                <Kpi label={t.kpiFiles} value={fillTemplate(t.kpiFilesValue, { count: m.withCoverage, total: m.files })} badge={prov('runtime')} />
                <Kpi label={t.kpiMean} value={m.meanCoverage === undefined ? labels.surface.notSetUp : pct(m.meanCoverage)} badge={prov('runtime')} />
                <Kpi label={t.kpiComplexity} value={m.withComplexity ? m.totalComplexity : labels.surface.notSetUp} badge={prov('deterministic')} />
                <Kpi label={t.kpiRisky} value={m.gapCount} tone={m.gapCount > 0 ? 'violation' : 'agrees'} badge={prov('heuristic')} />
            </div>
            <Section title={t.scatterTitle}>
                {m.points.length === 0 ? <p style={{ ...muted, margin: 0 }}>{t.noComplexity}</p> : (
                    <svg role="img" aria-label={fillTemplate(t.scatterAria, { count: m.points.length })} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: 360, ...card, padding: 4 }}>
                        <rect data-testid="kg-risk-quadrant" x={x(m.maxComplexity / 2)} y={y(UNTESTED_BELOW)} width={W - 8 - x(m.maxComplexity / 2)} height={H - PAD - y(UNTESTED_BELOW)} fill={cssVar('violation')} fillOpacity={0.12} />
                        <text x={x(m.maxComplexity / 2) + 4} y={H - PAD - 4} fontSize={9} fontWeight={600} fill={cssVar('violation')}>{t.quadrant}</text>
                        <line x1={PAD} y1={H - PAD} x2={W - 8} y2={H - PAD} stroke={cssVar('border')} />
                        <line x1={PAD} y1={8} x2={PAD} y2={H - PAD} stroke={cssVar('border')} />
                        <text x={W / 2} y={H - 6} textAnchor="middle" fontSize={10} fill={cssVar('muted')}>{t.axisX}</text>
                        <text x={10} y={H / 2} fontSize={10} fill={cssVar('muted')} transform={`rotate(-90 10 ${H / 2})`} textAnchor="middle">{t.axisY}</text>
                        {m.points.map((p) => (
                            <circle key={p.ref} data-point={p.ref} cx={x(p.complexity)} cy={y(p.coverage)} r={4} fill={cssVar(coverageTone(p.coverage))} fillOpacity={0.8} stroke={cssVar('bg')} />
                        ))}
                    </svg>
                )}
            </Section>
            <Section title={t.gapsTitle}>
                {m.gaps.length === 0 ? <p style={{ ...muted, margin: 0 }}>{t.gapsNone}</p> : (
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                        {m.gaps.map((g) => (
                            <li key={g.ref} data-gap={g.ref} style={{ ...card, display: 'grid', gap: 6 }}>
                                <strong style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{g.name}</strong>
                                <span style={muted}>{fillTemplate(t.gapRow, { complexity: g.complexity, coverage: pct(g.coverage) })}</span>
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                    <button type="button" style={button} onClick={() => simulate(g.ref)}>{t.runWithValues}</button>
                                    <button
                                        type="button" style={button} disabled={!onCompose}
                                        onClick={() => onCompose?.(fillTemplate(t.promptText, { file: g.name, complexity: g.complexity, coverage: pct(g.coverage) }))}
                                    >
                                        {t.promptTests}
                                    </button>
                                </div>
                                {!onCompose && <Unavailable labels={labels} label={t.promptTests} />}
                            </li>
                        ))}
                    </ul>
                )}
            </Section>
            <CoverageShape graph={graph} labels={labels} onCompose={onCompose} />
        </div>
    );
}

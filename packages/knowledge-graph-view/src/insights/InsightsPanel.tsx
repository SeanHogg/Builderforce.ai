/**
 * Insights — the deterministic reading of the graph, in every view: metric tiles (each
 * opens the lens that explains it, when the graph offers that lens) and bar charts for
 * composition, hotspots, coupling and findings. Nothing here calls a model.
 */

import { useMemo } from 'react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { camelKind, fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { kindLabel } from '../names';
import { cssVar, type ThemeTone } from '../scene/themeColors';
import { heading } from '../styles';
import type { LensId } from '../types';
import { BarChart, type ChartRow } from './BarChart';
import { insightsOf, type Bar, type MetricId } from './insightsModel';

export interface InsightsPanelProps {
    graph: KnowledgeGraph;
    labels: KnowledgeGraphLabels;
    /** The lenses this graph offers: a tile whose lens is not among them is not a button. */
    lenses: readonly LensId[];
    onLens(id: LensId): void;
    onShow(refs: string[]): void;
    /** False where the findings are listed with their own counts right beside (the list view). */
    findingKinds?: boolean;
}

/** Tiles that always show; the others appear when there is something to count. */
const CORE: ReadonlySet<MetricId> = new Set(['files', 'edges', 'findings']);

const rows = (bars: readonly Bar[], word: (b: Bar) => string): ChartRow[] =>
    bars.map((b) => ({ key: b.id, label: word(b), value: b.value, refs: b.refs }));

export function InsightsPanel({ graph, labels, lenses, onLens, onShow, findingKinds = true }: InsightsPanelProps) {
    const insights = useMemo(() => insightsOf(graph), [graph]);
    const part = (id: string): string => id || labels.partitionNone;
    const tiles = insights.metrics.filter((m) => CORE.has(m.id) || m.value > 0);
    const charts: Array<{ title: string; rows: ChartRow[]; tone: ThemeTone }> = [
        { title: labels.chartKinds, rows: rows(insights.kinds, (b) => kindLabel(labels, b.id)), tone: 'nodeFile' },
        {
            title: insights.composition.by === 'partition' ? labels.chartPartitions : labels.chartAreas,
            rows: rows(insights.composition.bars, (b) => b.text ?? part(b.id)), tone: 'nodeSection',
        },
        { title: labels.hotspotsIn, rows: rows(insights.fanIn, (b) => b.text ?? b.id), tone: 'accent' },
        { title: labels.hotspotsOut, rows: rows(insights.fanOut, (b) => b.text ?? b.id), tone: 'accent' },
        {
            title: labels.couplingTitle,
            rows: insights.coupling.map((c) => ({ key: c.id, label: `${part(c.from)} → ${part(c.to)}`, value: c.value, refs: c.refs })),
            tone: 'edge',
        },
        { title: labels.chartFindings, rows: rows(insights.findingKinds, (b) => labels.findingKinds[camelKind(b.id)] ?? b.id), tone: 'violation' },
    ];
    const tile = { display: 'grid', gap: 2, alignContent: 'center', minHeight: 56, padding: '6px 10px', borderRadius: 8, textAlign: 'start', font: 'inherit', color: cssVar('text'), border: `1px solid ${cssVar('border')}`, background: cssVar('panel') } as const;

    return (
        <section aria-label={labels.insightsTitle} data-testid="kg-insights" style={{ display: 'grid', gap: 12 }}>
            <h3 style={heading}>{labels.insightsTitle}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 6 }}>
                {tiles.map((m) => {
                    // A truncated graph holds only part of its files: say how many of how many are loaded.
                    const partial = m.id === 'files' && graph.stats.truncated === true && graph.stats.sources > m.value;
                    const body = (
                        <>
                            <span style={{ fontSize: partial ? 13 : 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>
                                {partial ? fillTemplate(labels.filesLoaded, { loaded: m.value.toLocaleString(), total: graph.stats.sources.toLocaleString() }) : m.value}
                            </span>
                            <span style={{ fontSize: 11, color: cssVar('muted') }}>{labels.metrics[m.id] ?? m.id}</span>
                        </>
                    );
                    const lens = m.lens && lenses.includes(m.lens) ? m.lens : undefined;
                    return lens
                        ? <button key={m.id} type="button" data-metric={m.id} style={{ ...tile, cursor: 'pointer' }} title={labels.lenses[lens]} onClick={() => onLens(lens)}>{body}</button>
                        : <div key={m.id} data-metric={m.id} style={tile}>{body}</div>;
                })}
            </div>
            {charts.filter((c) => c.rows.length > 0 && (findingKinds || c.title !== labels.chartFindings)).map((c) => <BarChart key={c.title} title={c.title} rows={c.rows} tone={c.tone} onPick={onShow} />)}
        </section>
    );
}

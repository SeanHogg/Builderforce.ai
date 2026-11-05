/**
 * The right panel: what a person can act on for the current scope (a station, a line the
 * person picked, or the whole graph). It wraps the existing findings panel (grouped, lazy,
 * Fix-with-agent multiselect, Show) and adds a provenance badge to every row, so a finding
 * says whether it is deterministic analysis, a heuristic, or a runtime measurement. Fix with
 * agent goes to the host's composer; Apply for deterministic codemods is a later addition.
 */

import type { ReactNode } from 'react';
import type { Finding, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { FindingsPanel } from '../FindingsPanel';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { cssVar, type ThemeTone } from '../scene/themeColors';
import { button, heading, muted } from '../styles';
import type { FindingEvidence, SourceLocation } from '../types';
import type { Provenance } from './layers';
import { frac, metricStatus, type MetricId } from './overlays';
import { findingProvenance } from './scope';
import type { Station } from './stations';

const PROVENANCE_TONE: Record<Provenance, ThemeTone> = { deterministic: 'agrees', heuristic: 'cycle', runtime: 'accent' };

export function ProvenanceBadge({ provenance, labels }: { provenance: Provenance; labels: KnowledgeGraphLabels }) {
    const tone = cssVar(PROVENANCE_TONE[provenance]);
    return (
        <span data-provenance={provenance} style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999, whiteSpace: 'nowrap', border: `1px solid ${tone}`, color: tone }}>
            {labels.surface.provenance[provenance]}
        </span>
    );
}

export interface ActPanelProps {
    graph: KnowledgeGraph;
    /** The findings of the scope (already filtered). */
    findings: readonly Finding[];
    labels: KnowledgeGraphLabels;
    /** The station the person is on, if any; its facts head the panel. */
    station: Station | null;
    /** Every station, to tell "not set up" from "this station has none". */
    stations: readonly Station[];
    /** The scope's name; null = the whole graph. */
    scopeName: string | null;
    compact: boolean;
    /** False where the findings are listed beside already (the list camera). */
    showFindings?: boolean;
    onClearScope(): void;
    onShow(refs: string[]): void;
    onCompose?: ((text: string) => void) | undefined;
    /** Opens the Resolve drawer on a finding. */
    onResolve?: ((f: Finding) => void) | undefined;
    evidence?: ((f: Finding) => FindingEvidence[]) | undefined;
    onOpenSource?: ((location: SourceLocation) => void) | undefined;
    /** The insights and lens panels, above the findings. */
    children?: ReactNode;
}

const FACT_METRICS: readonly MetricId[] = ['anti', 'cx', 'cov', 'churn', 'use', 'owner'];

function factValue(m: MetricId, st: Station, stations: readonly Station[], labels: KnowledgeGraphLabels): string {
    const s = labels.surface;
    if (metricStatus(m, stations) === 'not-set-up') return s.notSetUp;
    if (m === 'owner') return st.owner ?? s.notSetUp;
    if (m === 'cov') return st.cov === undefined ? s.notSetUp : `${Math.round(st.cov * 100)}%`;
    if (m === 'use' || m === 'churn') { const f = frac(m, st); return f === undefined ? s.notSetUp : `${Math.round(f * 100)}%`; }
    const level = m === 'anti' ? st.anti : st.cx;
    return level === undefined ? s.notSetUp : fillTemplate(s.levelOf5, { level });
}

export function ActPanel(p: ActPanelProps) {
    const { labels, station } = p;
    const s = labels.surface;
    return (
        <aside
            aria-label={labels.findingsTitle}
            style={{
                width: p.compact ? 'auto' : 340, flex: 'none', overflow: 'auto', padding: 12, display: 'grid', gap: 12, alignContent: 'start',
                borderInlineStart: p.compact ? 'none' : `1px solid ${cssVar('border')}`,
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h2 style={{ ...heading, flex: 1 }}>{s.actTitle}</h2>
                <span style={muted}>{fillTemplate(s.actScope, { scope: p.scopeName ?? s.actScopeAll })}</span>
                {p.scopeName !== null && <button type="button" style={button} onClick={p.onClearScope}>{s.actScopeAll}</button>}
            </div>
            {station && (
                <section aria-label={s.stationFacts} data-testid="kg-station-facts" style={{ display: 'grid', gap: 6 }}>
                    <h3 style={heading}>{station.name}</h3>
                    <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px', fontSize: 12 }}>
                        {FACT_METRICS.map((m) => (
                            <div key={m} style={{ display: 'contents' }}>
                                <dt style={muted}>{s.metricNames[m]}</dt>
                                <dd style={{ margin: 0 }}>{factValue(m, station, p.stations, labels)}</dd>
                            </div>
                        ))}
                    </dl>
                    <div><button type="button" style={button} onClick={() => p.onShow(station.refs.slice(0, 200))}>{s.showFiles}</button></div>
                </section>
            )}
            {p.children}
            {p.showFindings !== false && <FindingsPanel
                graph={p.graph} findings={p.findings} labels={labels} onShow={p.onShow} onCompose={p.onCompose} evidence={p.evidence}
                onOpenSource={p.onOpenSource} onResolve={p.onResolve} badge={(f) => <ProvenanceBadge provenance={findingProvenance(f)} labels={labels} />}
            />}
        </aside>
    );
}

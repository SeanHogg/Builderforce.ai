/**
 * The right rail, Act (330px, panel background, a border on the scene side): what a person can
 * act on for the current scope (a station, a line the person picked, or the whole graph).
 *
 * Top to bottom: the scope; the station's stats as a compact two-column grid ("Not set up"
 * muted); up to three action cards (numbered pin on the heat ramp, title, detail, Apply only
 * where a deterministic fix exists and the host can apply it, Prompt, Show, and where the
 * finding came from: exact / analyzer / model); the Fix queue link; "Keep this run as a test"
 * for a selected path; the full findings list (grouped, lazy, multiselect Fix with agent); a
 * collapsed "Details" section holding the Insights and Lens panels (children); and the footer
 * "This path is done when…" with one checkable line per finding on the path.
 *
 * Apply goes through the Resolve drawer (`onResolve`), which is where the codemod runs. Nothing
 * here calls a model: Prompt and Keep-as-test put FIXED requests in the host's composer.
 */

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { Finding, KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { FindingsPanel } from '../FindingsPanel';
import { findingDetail, findingItems, findingRequest, findingTitle } from '../findingText';
import { nodeIndex } from '../graphModel';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { cssVar, type ThemeTone } from '../scene/themeColors';
import { button, heading, heatColor, MONO, muted } from '../styles';
import type { FindingEvidence, SourceLocation } from '../types';
import { acceptanceChecks, actionCards, testRequestFor, type ActionCard, type FindingSource } from './actModel';
import type { Provenance } from './layers';
import { frac, metricStatus, type MetricId } from './overlays';
import type { PathModel } from './path';
import { findingProvenance } from './scope';
import type { Station } from './stations';
import { Card, pillStyle } from './ui';

const PROVENANCE_TONE: Record<Provenance, ThemeTone> = { deterministic: 'agrees', heuristic: 'cycle', runtime: 'accent' };
const SOURCE_TONE: Record<FindingSource, ThemeTone> = { exact: 'agrees', analyzer: 'accent', model: 'cycle' };

export function ProvenanceBadge({ provenance, labels }: { provenance: Provenance; labels: KnowledgeGraphLabels }) {
    const tone = cssVar(PROVENANCE_TONE[provenance]);
    return (
        <span data-provenance={provenance} style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999, whiteSpace: 'nowrap', border: `1px solid ${tone}`, color: tone }}>
            {labels.surface.provenance[provenance]}
        </span>
    );
}

/** Where a card's finding comes from: exact / analyzer / model. */
export function SourceChip({ source, labels }: { source: FindingSource; labels: KnowledgeGraphLabels }) {
    const tone = cssVar(SOURCE_TONE[source]);
    const t = labels.surface.act;
    const word = source === 'exact' ? t.sourceExact : source === 'analyzer' ? t.sourceAnalyzer : t.sourceModel;
    return <span data-source={source} style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999, whiteSpace: 'nowrap', border: `1px solid ${tone}`, color: tone }}>{word}</span>;
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
    /** A phone: the rail is a section under the scene, with Coverage · API · Fix queue as links. */
    compact: boolean;
    /** False where the findings are listed beside already (the list camera). */
    showFindings?: boolean;
    onClearScope(): void;
    onShow(refs: string[]): void;
    onCompose?: ((text: string) => void) | undefined;
    /** Opens the Resolve drawer on a finding (where Apply runs). */
    onResolve?: ((f: Finding) => void) | undefined;
    evidence?: ((f: Finding) => FindingEvidence[]) | undefined;
    onOpenSource?: ((location: SourceLocation) => void) | undefined;
    /** The host's source can apply a deterministic fix (`!!source.applyFix`): Apply shows on unused-export / unused-file cards. */
    canApply?: boolean | undefined;
    /** Opens a drawer by PANELS id (`surface.openPanel`): the Fix queue link opens 'resolve'. */
    onOpenPanel?: ((id: string) => void) | undefined;
    /** The selected line's or pinned path; with stops it offers Keep-as-test and the done-when footer. */
    path?: PathModel | null | undefined;
    /** The path's name in the test request, e.g. "Web line · GET /users"; defaults to the stop names. */
    pathTitle?: string | null | undefined;
    /** The Insights and Lens panels: held in the collapsed "Details" section. */
    children?: ReactNode;
}

const FACT_METRICS: readonly MetricId[] = ['cx', 'cov', 'churn', 'use', 'owner', 'anti'];

function factValue(m: MetricId, st: Station, stations: readonly Station[], labels: KnowledgeGraphLabels): string {
    const s = labels.surface;
    if (metricStatus(m, stations) === 'not-set-up') return s.notSetUp;
    if (m === 'owner') return st.owner ?? s.notSetUp;
    if (m === 'cov') return st.cov === undefined ? s.notSetUp : `${Math.round(st.cov * 100)}%`;
    if (m === 'use' || m === 'churn') { const f = frac(m, st); return f === undefined ? s.notSetUp : `${Math.round(f * 100)}%`; }
    const level = m === 'anti' ? st.anti : st.cx;
    return level === undefined ? s.notSetUp : fillTemplate(s.levelOf5, { level });
}

const small: CSSProperties = { ...button, minHeight: `calc(var(--kg-control, 40px) - 4px)`, minWidth: 0, padding: '0 10px', borderRadius: 999, fontSize: 12 };

function Cards({ cards, p, index }: { cards: ActionCard[]; p: ActPanelProps; index: ReadonlyMap<string, KNode> }) {
    const { labels } = p;
    const t = labels.surface.act;
    const act = (action: string, title: string) => fillTemplate(t.cardAction, { action, title });
    return (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }} aria-label={t.cardsTitle}>
            {cards.map(({ finding: f, level, source, canApply }, i) => {
                const title = findingTitle(f, labels);
                return (
                    <Card as="li" key={f.id} style={{ display: 'grid', gap: 6 }}>
                        <div data-card={f.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                            <span
                                aria-hidden="true"
                                style={{ flex: 'none', width: 22, height: 22, borderRadius: 999, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, fontFamily: MONO, background: heatColor(level), color: cssVar('bg') }}
                            >
                                {i + 1}
                            </span>
                            <strong style={{ flex: 1, minWidth: 0, fontSize: 13, overflowWrap: 'anywhere' }}>{title}</strong>
                            <SourceChip source={source} labels={labels} />
                        </div>
                        <p style={{ ...muted, margin: 0, overflowWrap: 'anywhere', fontFamily: MONO, fontSize: 12 }}>{findingDetail(f, labels, index) ?? findingItems(f, index)}</p>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {canApply && p.onResolve && (
                                <button type="button" data-act="apply" aria-label={act(t.apply, title)} style={{ ...small, background: cssVar('accent'), color: cssVar('onAccent'), borderColor: cssVar('accent') }} onClick={() => p.onResolve?.(f)}>{t.apply}</button>
                            )}
                            {p.onCompose && (
                                <button type="button" data-act="prompt" aria-label={act(t.prompt, title)} style={small} onClick={() => p.onCompose?.(findingRequest(f, labels, index))}>{t.prompt}</button>
                            )}
                            <button type="button" data-act="show" aria-label={act(t.show, title)} style={small} onClick={() => p.onShow([...f.nodes])}>{t.show}</button>
                        </div>
                    </Card>
                );
            })}
        </ol>
    );
}

export function ActPanel(p: ActPanelProps) {
    const { labels, station, path } = p;
    const s = labels.surface;
    const t = s.act;
    const [details, setDetails] = useState(false);
    const index = useMemo(() => nodeIndex(p.graph), [p.graph]);
    const cards = useMemo(() => actionCards(p.findings, p.canApply === true), [p.findings, p.canApply]);
    const hasPath = !!path && path.stops.length > 0;
    const done = useMemo(() => acceptanceChecks(p.findings, labels, index), [p.findings, labels, index]);
    const pathName = p.pathTitle || path?.stops.map((x) => x.name).join(' → ') || '';
    const queue = fillTemplate(t.fixQueue, { count: p.findings.length });

    return (
        <aside
            aria-label={labels.findingsTitle}
            style={{
                width: p.compact ? 'auto' : 330, flex: 'none', overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12, boxSizing: 'border-box',
                background: cssVar('panel'), borderInlineStart: p.compact ? 'none' : `1px solid ${cssVar('border')}`,
                ...(p.compact ? { borderTop: `1px solid ${cssVar('border')}` } : null),
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h2 style={{ ...heading, flex: 1 }}>{s.actTitle}</h2>
                <span style={muted}>{fillTemplate(s.actScope, { scope: p.scopeName ?? s.actScopeAll })}</span>
                {p.scopeName !== null && <button type="button" style={small} onClick={p.onClearScope}>{s.actScopeAll}</button>}
            </div>

            {station && (
                <section aria-label={s.stationFacts} data-testid="kg-station-facts" style={{ display: 'grid', gap: 8 }}>
                    <h3 style={{ ...heading, fontFamily: MONO, fontSize: 13, overflowWrap: 'anywhere' }}>{station.name}</h3>
                    <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                        {FACT_METRICS.map((m) => {
                            const value = factValue(m, station, p.stations, labels);
                            return (
                                <div key={m} data-fact={m} style={{ display: 'grid', gap: 1, padding: '6px 8px', borderRadius: 8, border: `1px solid ${cssVar('border')}`, background: cssVar('bg'), minWidth: 0 }}>
                                    <dt style={{ ...muted, fontSize: 11 }}>{s.metricNames[m]}</dt>
                                    <dd style={{ margin: 0, fontFamily: MONO, fontSize: 12, overflowWrap: 'anywhere', color: value === s.notSetUp ? cssVar('muted') : cssVar('text') }}>{value}</dd>
                                </div>
                            );
                        })}
                    </dl>
                    <div><button type="button" style={small} onClick={() => p.onShow(station.refs.slice(0, 200))}>{s.showFiles}</button></div>
                </section>
            )}

            <section aria-label={t.cardsTitle} style={{ display: 'grid', gap: 8 }}>
                <h3 style={heading}>{t.cardsTitle}</h3>
                {cards.length === 0 ? <p style={{ ...muted, margin: 0 }}>{t.noCards}</p> : <Cards cards={cards} p={p} index={index} />}
                {p.onOpenPanel && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        {p.compact && <button type="button" data-link="coverage" style={small} onClick={() => p.onOpenPanel?.('coverage')}>{t.linkCoverage}</button>}
                        {p.compact && <button type="button" data-link="api" style={small} onClick={() => p.onOpenPanel?.('api')}>{t.linkApi}</button>}
                        <button type="button" data-link="resolve" style={{ ...small, ...pillStyle(false), fontWeight: 600 }} onClick={() => p.onOpenPanel?.('resolve')}>{queue}</button>
                    </div>
                )}
            </section>

            {hasPath && p.onCompose && (
                <Card as="section" label={t.keepTitle} style={{ display: 'grid', gap: 6 }}>
                    <strong style={{ fontSize: 13 }}>{t.keepTitle}</strong>
                    <p style={{ ...muted, margin: 0, overflowWrap: 'anywhere' }}>{fillTemplate(t.keepBody, { path: pathName })}</p>
                    <div><button type="button" data-act="keep-test" style={small} onClick={() => p.onCompose?.(testRequestFor(path!, pathName, p.findings, labels, index))}>{t.keepButton}</button></div>
                </Card>
            )}

            {p.showFindings !== false && (
                <FindingsPanel
                    graph={p.graph} findings={p.findings} labels={labels} onShow={p.onShow} onCompose={p.onCompose} evidence={p.evidence}
                    onOpenSource={p.onOpenSource} onResolve={p.onResolve} badge={(f) => <ProvenanceBadge provenance={findingProvenance(f)} labels={labels} />}
                />
            )}

            {p.children && (
                <section aria-label={t.detailsTitle} style={{ display: 'grid', gap: 8 }}>
                    <button
                        type="button" aria-expanded={details} aria-controls="kg-act-details" data-testid="kg-act-details-toggle"
                        style={{ ...small, width: '100%', justifyContent: 'space-between', display: 'flex', alignItems: 'center', fontWeight: 700 }} onClick={() => setDetails((v) => !v)}
                    >
                        <span>{t.detailsTitle}</span><span aria-hidden="true">{details ? '▾' : '▸'}</span>
                    </button>
                    <div id="kg-act-details" hidden={!details} style={{ display: details ? 'grid' : 'none', gap: 12 }}>{p.children}</div>
                </section>
            )}

            {hasPath && (
                <footer data-testid="kg-done-when" style={{ marginTop: 'auto', paddingTop: 10, borderTop: `1px solid ${cssVar('border')}`, display: 'grid', gap: 6 }}>
                    <h3 style={{ ...heading, fontSize: 13 }}>{t.doneTitle}</h3>
                    {done.checks.length === 0 ? <p style={{ ...muted, margin: 0 }}>{t.doneNone}</p> : (
                        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
                            {done.checks.map((c) => (
                                <li key={c} style={{ display: 'flex', gap: 6, fontSize: 12, alignItems: 'flex-start' }}>
                                    <span aria-hidden="true" style={{ flex: 'none', width: 12, height: 12, marginTop: 2, borderRadius: 3, border: `1.5px solid ${cssVar('edge')}` }} />
                                    <span style={{ overflowWrap: 'anywhere' }}>{c}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                    {done.more > 0 && <p style={{ ...muted, margin: 0 }}>{fillTemplate(t.doneMore, { count: done.more })}</p>}
                </footer>
            )}
        </aside>
    );
}

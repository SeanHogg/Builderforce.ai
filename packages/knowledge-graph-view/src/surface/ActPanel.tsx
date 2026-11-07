/**
 * The right rail, Act (330px, panel background, a border on the scene side): what a person can act on
 * for the current scope (a station, the drawn line, or the whole graph).
 *
 * Top to bottom: the title ("At {scope} · N issues", or "On this path · N to act on" with a line drawn)
 * with "Fix queue · N" at its right; the system-wide findings in one compact block; at most three
 * action cards (pin, title, detail, Apply / Prompt / Show, and where the finding came from) or, when
 * nothing is open, a check-mark card; "Keep this run as a test" for a path with a hop; a collapsed
 * "Details" section holding the full findings list, Insights and the view panel (children); and the
 * footer "This path is done when…" pinned at the bottom. The station's own stats live on its card.
 *
 * Apply goes through the Resolve drawer (`onResolve`), which is where the codemod runs. Nothing here
 * calls a model: Prompt and Keep-as-test put FIXED requests in the host's composer.
 */

import { useId, useMemo, useState, type ReactNode } from 'react';
import type { Finding, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { FindingsPanel } from '../FindingsPanel';
import { nodeIndex } from '../graphModel';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { counted } from './plural';
import { cssVar } from '../scene/themeColors';
import type { FindingEvidence, SourceLocation } from '../types';
import { actionCards } from './actModel';
import { Cards, EmptyCard, smallButton, SystemWideBlock } from './ActCards';
import { DoneWhen, hasHops, KeepTestCard } from './ActFooter';
import { DuplicateCopyCards, type CopyFix } from './fix/DuplicateCopyCard';
import { isDuplicateCopy } from './fix/duplicateCopy';
import { fixQueueCounts, fixQueueText } from './fix/fixModes';
import type { PathModel } from './path';
import { pinNumbers } from './pinNumbers';
import { findingProvenance } from './scope';
import { systemWideFindings, type Station, type StationModel } from './stations';
import { pillStyle, ProvenanceBadge } from './ui';
import { TYPE } from './ui/type';

export { SourceChip } from './ActCards';

export interface ActPanelProps {
    graph: KnowledgeGraph;
    /** The findings of the scope: `graph.findings` scoped by the stations and, when a question is on, by what it lit. */
    findings: readonly Finding[];
    /** The findings the Details list shows: the scope's findings narrowed to what the active LENS surfaces (default: all of `findings`). The cards, count and queue above never narrow. */
    listedFindings?: readonly Finding[] | undefined;
    /** The active lens's name: the Findings heading says it when the list is narrower than `findings`. */
    lensName?: string | undefined;
    labels: KnowledgeGraphLabels;
    /** The station the person is on, if any; the title names it. */
    station: Station | null;
    /** Every station (kept for the host's wiring; the rail reads the station model for system-wide findings). */
    stations: readonly Station[];
    /** The station model's `systemWide` set: those findings are listed once at the top, not as cards. */
    model?: Pick<StationModel, 'systemWide'> | undefined;
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
    canApply?: boolean | ((kind: string) => boolean) | undefined;
    /** Ids of the findings the fix flow resolved this session: they are not "open" in the queue count. */
    resolved?: ReadonlySet<string> | undefined;
    /** Opens a drawer by PANELS id (`surface.openPanel`): the Fix queue link opens 'resolve'. */
    onOpenPanel?: ((id: string) => void) | undefined;
    /** Asks the "What has no test?" question (the empty state's button). */
    onAskUntested?: (() => void) | undefined;
    /** The drawn line's or pinned path; with a hop it offers Keep-as-test and the done-when footer. */
    path?: PathModel | null | undefined;
    /** The path's name in the test request, e.g. "Web line · GET /users"; defaults to the stop names. */
    pathTitle?: string | null | undefined;
    /** Stray-copy cards' Exclude from review (`source.folders`); absent ⇒ the host cannot exclude a folder and those cards are drawn as ordinary ones. */
    copyFix?: CopyFix | undefined;
    /** The Insights and view panels: held in the collapsed "Details" section. */
    children?: ReactNode;
}

export function ActPanel(p: ActPanelProps) {
    const { labels, station, path } = p;
    const s = labels.surface;
    const t = s.act;
    // Collapsed by default: the cards say what to do; the full list, Insights and the view panel are one click away.
    const [details, setDetails] = useState(false);
    const detailsId = useId();
    const index = useMemo(() => nodeIndex(p.graph), [p.graph]);
    const pins = useMemo(() => pinNumbers(p.graph.findings), [p.graph.findings]);
    const wide = useMemo(() => systemWideFindings(p.model ?? {}, p.findings), [p.model, p.findings]);
    const local = useMemo(() => { const ids = new Set(wide.map((f) => f.id)); return p.findings.filter((f) => !ids.has(f.id)); }, [p.findings, wide]);
    // A stray copy has its own card (with Exclude from review) wherever the host can exclude a folder; elsewhere it is an ordinary card.
    const copies = useMemo(() => (p.copyFix ? local.filter(isDuplicateCopy) : []), [local, p.copyFix]);
    const cards = useMemo(() => actionCards(copies.length > 0 ? local.filter((f) => !isDuplicateCopy(f)) : local, p.canApply ?? false), [local, copies, p.canApply]);
    const drawn = !!path && path.stops.length > 0;
    const count = p.findings.length;
    const title = station ? counted(labels, 'issueAt', count, { scope: station.name })
        : drawn ? fillTemplate(t.titlePath, { count })
            : counted(labels, 'issueAt', count, { scope: s.actScopeAll });
    const pathName = p.pathTitle || path?.stops.map((x) => x.name).join(' → ') || '';
    const queue = fillTemplate(t.fixQueue, { count });
    const queueCounts = fixQueueText(fixQueueCounts(p.findings, p.graph.findings.length, p.resolved ?? new Set()), labels);
    const emptyRefs = (): string[] => (station ? station.refs : p.stations.filter((x) => path?.stops.some((stop) => stop.id === x.id)).flatMap((x) => x.refs)).slice(0, 200);
    const hasDetails = p.showFindings !== false || !!p.children;

    return (
        <aside
            aria-label={labels.findingsTitle}
            style={{
                width: p.compact ? 'auto' : 330, flex: 'none', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box',
                background: cssVar('panel'), borderInlineStart: p.compact ? 'none' : `1px solid ${cssVar('border')}`,
                ...(p.compact ? { borderTop: `1px solid ${cssVar('border')}` } : null),
            }}
        >
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <h2 data-testid="kg-act-title" style={{ ...TYPE.sectionHeading, flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{title}</h2>
                    {p.onOpenPanel && (
                        <button type="button" data-link="resolve" style={{ ...smallButton, ...pillStyle(false), fontWeight: 600 }} onClick={() => p.onOpenPanel?.('resolve')}>{queue}</button>
                    )}
                    {p.scopeName !== null && <button type="button" style={smallButton} onClick={p.onClearScope}>{s.actScopeAll}</button>}
                </div>
                {p.onOpenPanel && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: -6 }}>
                        {p.compact && <button type="button" data-link="coverage" style={smallButton} onClick={() => p.onOpenPanel?.('coverage')}>{t.linkCoverage}</button>}
                        {p.compact && <button type="button" data-link="api" style={smallButton} onClick={() => p.onOpenPanel?.('api')}>{t.linkApi}</button>}
                        <span data-testid="kg-act-queue" style={TYPE.meta}>{queueCounts}</span>
                    </div>
                )}

                {wide.length > 0 && <SystemWideBlock findings={wide} labels={labels} onShow={p.onShow} />}

                <DuplicateCopyCards findings={copies} labels={labels} fix={p.copyFix} onShow={p.onShow} />

                {count === 0
                    ? <EmptyCard labels={labels} atStation={!!station} onAsk={() => p.onAskUntested?.()} onShow={() => p.onShow(emptyRefs())} />
                    : cards.length > 0 && <Cards cards={cards} labels={labels} index={index} pins={pins} onShow={p.onShow} onCompose={p.onCompose} onResolve={p.onResolve} />}

                {hasHops(path) && p.onCompose && <KeepTestCard path={path} pathName={pathName} findings={p.findings} labels={labels} index={index} onCompose={p.onCompose} />}

                {hasDetails && (
                    <section aria-label={t.detailsTitle} style={{ display: 'grid', gap: 8 }}>
                        <button
                            type="button" aria-expanded={details} aria-controls={detailsId} data-testid="kg-act-details-toggle"
                            style={{ ...smallButton, width: '100%', justifyContent: 'space-between', display: 'flex', alignItems: 'center', fontWeight: 700 }} onClick={() => setDetails((v) => !v)}
                        >
                            <span>{t.detailsTitle}</span><span aria-hidden="true">{details ? '▾' : '▸'}</span>
                        </button>
                        <div id={detailsId} hidden={!details} style={{ display: details ? 'grid' : 'none', gap: 12 }}>
                            {p.showFindings !== false && (
                                <FindingsPanel
                                    graph={p.graph} findings={p.listedFindings ?? p.findings} total={p.findings.length} lensName={p.lensName} labels={labels} onShow={p.onShow} onCompose={p.onCompose} evidence={p.evidence}
                                    scope={station?.name ?? (drawn ? pathName : undefined)}
                                    onOpenSource={p.onOpenSource} onResolve={p.onResolve} badge={(f) => <ProvenanceBadge provenance={findingProvenance(f)} labels={labels} />}
                                />
                            )}
                            {p.children}
                        </div>
                    </section>
                )}
            </div>

            {hasHops(path) && <DoneWhen findings={p.findings} labels={labels} index={index} />}
        </aside>
    );
}

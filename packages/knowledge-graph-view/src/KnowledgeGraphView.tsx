/**
 * `KnowledgeGraphView` — the ONE view of a knowledge graph, on every host (PRD 38 §4.6).
 *
 * The default view is the 2D graph; the 3D scene (a lazy chunk, only where WebGL exists), the
 * folder mind map and the list are one chip away, and the insights aside shows in every one.
 * In a compact container (a phone, a narrow panel) the view
 * opens focused on the top 60 nodes, lenses scroll sideways and panels become bottom
 * sheets. With no reviewed folder it explains itself and offers **Review a folder**.
 */

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { resolveLabels, fillTemplate, type KnowledgeGraphLabels } from './labels';
import { useKnowledgeGraph } from './useKnowledgeGraph';
import { CopiedNote, useCopyText } from './copyText';
import { graphDiagnosticsText } from './graphDiagnostics';
import { lensFindings } from './lenses';
import { COMPACT_WIDTH, PHONE_FOCUS_NODES, focusGraph, lensGraph, nodeIndex, labelFor } from './graphModel';
import { useContainerWidth, useRenderEnvironment } from './environment';
import { Toolbar, type LensControl, type Revision } from './Toolbar';
import { ReviewLauncher } from './ReviewLauncher';
import { ReviewProgress } from './ReviewProgress';
import { ViewSurface } from './ViewSurface';
import { FindingsPanel } from './FindingsPanel';
import { LensPanel } from './LensPanel';
import { InsightsPanel } from './insights/InsightsPanel';
import { NodePanel } from './NodePanel';
import { TracePanel } from './TracePanel';
import { Panel } from './Sheet';
import { cssVar } from './scene/themeColors';
import { button, heading, muted, quietButton } from './styles';
import type { Finding } from '@seanhogg/builderforce-memory/knowledge';
import type { EvidenceSide, KnowledgeConfirm, KnowledgeGraphSource, KnowledgePanelRenderer, LensId, SourceLocation, ViewMode } from './types';

/** Nodes a desktop view draws at most (instanced geometry is sized for it). */
const MAX_DRAWN_NODES = 2000;

export interface KnowledgeGraphViewProps {
    source: KnowledgeGraphSource;
    /** Host words over the English defaults: `resolveLabels` merges every map key by key, so a host may pass a subset. */
    labels?: Partial<KnowledgeGraphLabels>;
    /** Puts a Fix-with-agent request in the host's ONE composer. Absent ⇒ no Fix button. */
    onCompose?(text: string): void;
    initialFocus?: string[];
    /** Open on the review launcher (a host's "Choose a folder to review" chip). */
    openReview?: boolean;
    initialLens?: LensId;
    /** The host's side panel (web: SlideOutPanel). */
    renderPanel?: KnowledgePanelRenderer;
    /** The host's destructive confirmation (web: useConfirm). */
    confirm?: KnowledgeConfirm;
    /** The host's lens subset; absent ⇒ every lens that applies to the graph. */
    lenses?: readonly LensId[];
    /** `tabs` when the lenses ARE the host panel's views (see `Toolbar`). Default `chips`. */
    lensControl?: LensControl;
    /** Opens a finding's line range in the host's editor. Absent ⇒ ranges are links or text. */
    onOpenSource?(location: SourceLocation): void;
}

export function KnowledgeGraphView({
    source, labels: partial, onCompose, initialFocus, openReview, initialLens, renderPanel, confirm, lenses: lensSubset, lensControl, onOpenSource,
}: KnowledgeGraphViewProps) {
    const labels = useMemo(() => resolveLabels(partial), [partial]);
    const kg = useKnowledgeGraph(source, {
        ...(initialLens ? { initialLens } : {}), ...(initialFocus ? { initialFocus } : {}), ...(lensSubset ? { lenses: lensSubset } : {}),
    });
    const rootRef = useRef<HTMLElement>(null);
    const width = useContainerWidth(rootRef);
    const compact = width > 0 && width < COMPACT_WIDTH;
    const env = useRenderEnvironment();
    const [chosen, setMode] = useState<ViewMode>('graph');
    const modes = useMemo<ViewMode[]>(() => (env.webgl ? ['graph', '3d', 'map', 'list'] : ['graph', 'map', 'list']), [env.webgl]);
    const mode: ViewMode = modes.includes(chosen) ? chosen : 'graph';
    const [showAll, setShowAll] = useState(false);
    const [tracing, setTracing] = useState(false);
    const [revision, setRevision] = useState<Revision>('after');
    // The always-available capture for a bug/improvement report (English on purpose — see reviewDiagnostics.ts).
    const diagCopy = useCopyText();

    // Before/After: offered when the host keeps a baseline; "before" draws the baseline graph.
    const keepsBaseline = !!source.baseline || !!source.snapshot;
    const showingBefore = revision === 'before' && !!kg.baseline;
    const graph = showingBefore ? kg.baseline!.graph : kg.graph;
    const side = showingBefore ? 'baseline' as const : 'current' as const;
    const evidenceFor = useMemo(
        () => (source.evidence ? (f: Finding, s: EvidenceSide) => source.evidence!(f, s) : undefined),
        [source],
    );
    const evidenceOf = useMemo(() => (evidenceFor ? (f: Finding) => evidenceFor(f, side) : undefined), [evidenceFor, side]);
    const { lens, selected } = kg;
    const visible = useMemo(() => {
        if (!graph) return null;
        const keep = [...kg.focus, ...(selected ? [selected] : [])];
        return focusGraph(graph, compact && !showAll ? PHONE_FOCUS_NODES : MAX_DRAWN_NODES, keep);
    }, [graph, compact, showAll, kg.focus, selected]);
    const drawn = useMemo(() => (visible ? lensGraph(visible, lens) : null), [visible, lens]);
    const index = useMemo(() => nodeIndex(graph ?? { nodes: [] }), [graph]);
    const copyDiagnostics = () => void diagCopy.copy(graphDiagnosticsText({
        status: kg.status, rootId: kg.rootId, graph: graph ?? null, drawn: drawn ? { nodes: drawn.nodes.length, edges: drawn.edges.length } : null,
        showAll, webgl: env.webgl, reducedMotion: env.reducedMotion, mode, width, compact, lens: lens.id,
        review: kg.review.state, lastPhase: kg.review.lastPhase, time: new Date().toISOString(),
    }));
    const titleOf = (rootId: string) => kg.scopes.find((s) => s.rootId === rootId)?.title ?? rootId;
    const show = (refs: string[]) => { kg.setFocus(refs); if (refs[0]) kg.select(refs[0]); };
    const select = (ref: string) => { setTracing(false); kg.select(ref); };

    const review = <ReviewProgress run={kg.review} labels={labels} titleOf={titleOf} onContinue={(rootId) => kg.review.start({ rootId })} />;
    const frame = (children: ReactNode) => (
        <section
            ref={rootRef}
            aria-label={labels.regionLabel}
            style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: cssVar('bg'), color: cssVar('text'), fontSize: 13 }}
        >
            {children}
        </section>
    );

    if (kg.status === 'error') {
        return frame(
            <div role="alert" style={{ padding: 24, display: 'grid', gap: 10, justifyItems: 'start' }}>
                <h2 style={heading}>{labels.errorTitle}</h2>
                <p style={{ ...muted, margin: 0 }}>{labels.errorBody}</p>
                <button type="button" style={button} onClick={kg.reload}>{labels.retry}</button>
            </div>,
        );
    }
    if (kg.status === 'load-failed') {
        // A scope exists but its graph is gone/unreadable — this is NOT the "never reviewed" empty state.
        return frame(
            <div role="alert" style={{ padding: 24, display: 'grid', gap: 12, justifyItems: 'start', maxWidth: 560 }}>
                <h2 style={heading}>{labels.loadFailedTitle}</h2>
                <p style={{ ...muted, margin: 0 }}>{labels.loadFailedBody}</p>
                <button type="button" style={button} onClick={kg.reload}>{labels.retry}</button>
                {review}
            </div>,
        );
    }
    if (kg.status === 'empty' || (kg.status === 'loading' && !graph)) {
        const empty = kg.status === 'empty';
        return frame(
            <div style={{ padding: 24, display: 'grid', gap: 12, justifyItems: 'start', maxWidth: 560 }}>
                {empty ? (
                    <>
                        <h2 style={heading}>{labels.emptyTitle}</h2>
                        <p style={{ ...muted, margin: 0, fontSize: 13 }}>{labels.emptyBody}</p>
                        <ReviewLauncher source={source} labels={labels} start={kg.review.start} defaultOpen={!!openReview} status={kg.review.state.status} />
                    </>
                ) : <p role="status" style={muted}>{labels.loading}</p>}
                {review}
            </div>,
        );
    }
    if (!graph || !visible || !drawn) return frame(<p role="status" style={muted}>{labels.loading}</p>);

    const findings = lensFindings(lens, graph);
    const truncated = graph.stats.truncated || visible.nodes.length < graph.nodes.length;

    return frame(
        <>
            <Toolbar
                labels={labels} scopes={kg.scopes} rootId={kg.rootId} onRoot={kg.selectRoot}
                lenses={kg.lenses} lens={lens.id} onLens={kg.setLens} onSearch={(q) => void kg.search(q)}
                modes={modes} mode={mode} onMode={setMode} lensControl={lensControl}
                {...(keepsBaseline ? { revision: { value: (showingBefore ? 'before' : 'after') as Revision, hasBefore: !!kg.baseline, onChange: setRevision } } : {})}
                actions={(
                    <>
                        <ReviewLauncher source={source} labels={labels} start={(req) => kg.review.start(req.target || req.pick ? req : { rootId: graph.scope.rootId })} primary={false} defaultOpen={!!openReview} status={kg.review.state.status} />
                        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                            <button type="button" style={{ ...quietButton, minHeight: 32 }} onClick={copyDiagnostics}>{labels.copyDiagnostics}</button>
                            <CopiedNote status={diagCopy.status} labels={labels} />
                        </span>
                    </>
                )}
            />
            <div style={{ display: 'grid', gap: 8, padding: '8px 12px' }}>
                {review}
                <p style={{ ...muted, margin: 0 }}>
                    {fillTemplate(labels.statsLine, { nodes: graph.stats.nodes, edges: graph.stats.edges, sources: graph.stats.sources })}
                    {truncated && <> · {compact && !showAll ? fillTemplate(labels.focusedNote, { count: visible.nodes.length }) : labels.truncatedNote}</>}
                    {compact && !showAll && visible.nodes.length < graph.nodes.length && (
                        <> <button type="button" style={{ ...quietButton, minHeight: 40 }} onClick={() => setShowAll(true)}>{labels.showAll}</button></>
                    )}
                </p>
                {kg.hits && kg.hits.length === 0 && <p role="status" style={{ ...muted, margin: 0 }}>{fillTemplate(labels.searchNoHits, { query: kg.query })}</p>}
            </div>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: compact ? 'column' : 'row', overflow: compact ? 'auto' : 'hidden' }}>
                <div style={{ position: 'relative', flex: 1, minHeight: compact ? 320 : 0, minWidth: 0, overflow: 'auto' }}>
                    <ViewSurface
                        mode={mode} graph={graph} drawn={drawn} lens={lens} labels={labels} rootTitle={titleOf(graph.scope.rootId)}
                        selected={selected} focus={kg.focus} reducedMotion={env.reducedMotion} onSelect={select} onShow={show}
                        onCompose={onCompose} evidence={evidenceOf} onOpenSource={onOpenSource}
                    />
                </div>
                <aside aria-label={labels.findingsTitle} style={{ width: compact ? 'auto' : 340, flex: 'none', overflow: 'auto', padding: 12, display: 'grid', gap: 12, alignContent: 'start', borderInlineStart: compact ? 'none' : `1px solid ${cssVar('border')}` }}>
                    <InsightsPanel graph={graph} labels={labels} lenses={kg.lenses.map((l) => l.id)} onLens={kg.setLens} onShow={show} findingKinds={mode !== 'list'} />
                    <LensPanel graph={graph} lens={lens} requested={kg.requested} baseline={kg.baseline} current={kg.graph} labels={labels} evidence={evidenceFor} onOpenSource={onOpenSource} />
                    {/* The list already holds every finding of the graph; the aside would only repeat them. */}
                    {mode !== 'list' && <FindingsPanel graph={graph} findings={findings} labels={labels} onShow={show} onCompose={onCompose} evidence={evidenceOf} onOpenSource={onOpenSource} />}
                </aside>
            </div>
            <Panel
                render={renderPanel} open={!!selected && index.has(selected)} compact={compact} closeLabel={labels.close}
                title={selected ? labelFor(index, selected) : labels.nodePanelTitle}
                onClose={() => { setTracing(false); kg.select(null); }}
            >
                {selected && (
                    <>
                        <NodePanel
                            graph={graph} nodeRef={selected} labels={labels} source={source} confirm={confirm}
                            onTrace={() => setTracing((v) => !v)} onSelect={select} onChanged={kg.reload}
                        />
                        {tracing && <TracePanel graph={graph} from={selected} labels={labels} />}
                    </>
                )}
            </Panel>
        </>,
    );
}

/**
 * `KnowledgeGraphView` — the ONE view of a knowledge graph, on every host (PRD 38 §4.6).
 *
 * A composition root: it holds the graph's state and the surface's state, and lays out the
 * parts, each its own module. Header (`surface/SurfaceHeader.tsx`: Out, the spine, search, the review
 * status and the Panels button); left, the lines and their stations; centre, the scene with its
 * toolbar (`surface/SceneOverlay.tsx`: views, 3D | Flat, questions, the compare bar) and the
 * journey row below; right, ONE drawer (`surface/Drawer.tsx`: Act, Coverage, Patterns, API, Simulate,
 * Fix, Review...), closed until opened. The lines and the stage's code pane hide via
 * `surface/usePanelVisibility.ts`. The cameras and the panels are registries (`surface/cameras.tsx`,
 * `surface/panels.ts`), so this file names none of them. What the chrome derives from the state
 * (the spine, the titles, the overlay's props) is `surface/useSurfaceChrome.ts`.
 *
 * Everything reflows by container width (`layout.ts`): at or under 900px the header wraps and the
 * drawer is a bottom sheet; below 840px the Lines list stacks above the journey; below the phone
 * width it is a sheet. With no reviewed folder it offers **Review a folder**.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Finding } from '@seanhogg/builderforce-memory/knowledge';
import { resolveLabels, fillTemplate, type KnowledgeGraphLabels } from './labels';
import { useKnowledgeGraph } from './useKnowledgeGraph';
import { currentLoadPhase, loadRunning, useFirstPaint, useHostLoadTrace, useTimedSource } from './useLoadTiming';
import { graphDiagnostics } from './graphDiagnostics';
import { lensFindings } from './lenses';
import { PHONE_FOCUS_NODES, lensGraph, nodeIndex } from './graphModel';
import { useGraphResident } from './compute/useGraphResident';
import { useComputed } from './compute/useComputed';
import { isSmall } from './compute/size';
import type { VisibleGraph } from './graphModel';
import { useStableGraph } from './stableGraph';
import { useContainerWidth, useRenderEnvironment } from './environment';
import { layoutOf, SCENE_TOP_FALLBACK } from './layout';
import { useReviewTargets } from './ReviewLauncher';
import { ViewSurface } from './ViewSurface';
import { LensPanel } from './LensPanel';
import { InsightsPanel } from './insights/InsightsPanel';
import { NodeSheet } from './NodeSheet';
import { Sheet } from './Sheet';
import { cssVar } from './scene/themeColors';
import { muted } from './styles';
import { CAMERAS } from './surface/cameras';
import { ActPanel } from './surface/ActPanel';
import { partnersOf } from './surface/coChange';
import { SceneOverlay } from './surface/SceneOverlay';
import { useSyncStatus } from './surface/useSyncStatus';
import { useReviewsPanel } from './surface/run/useReviewsPanel';
import { RetryUploadContext } from './surface/run/useRetryUpload';
import { useZoomHost, ZoomProvider } from './surface/zoom';
import { LinesPanel } from './surface/LinesPanel';
import { foldCopyFindings } from './surface/systems';
import { DockEdge } from './surface/PanelDock';
import { Drawer } from './surface/Drawer';
import { useDrawer } from './surface/useDrawer';
import { useOpenSimulate } from './surface/useOpenSimulate';
import { canApplyKind } from './surface/codemods';
import { showsTowers, useClearHighlightOutsideTower } from './surface/useShowInTower';
import { TowerLegend } from './surface/TowerLegend';
import { isResolved } from './surface/fix/fixFlow';
import { fixQueueCounts } from './surface/fix/fixModes';
import { docStations } from './surface/transit/docs';
import { typesPresent } from './shapes';
import { groupTermini } from './surface/transit/termini';
import { PathStrip } from './surface/PathStrip';
import { SurfaceHeader } from './surface/SurfaceHeader';
import { TimeSlider, useHistory } from './surface/TimeSlider';
import { FlatViewContext, useFlatView } from './surface/useFlatView';
import { usePanelVisibility } from './surface/usePanelVisibility';
import { Pill } from './surface/ui';
import { questionForLens } from './surface/questions';
import { useSurfaceActions } from './surface/useSurfaceActions';
import { useSurfaceChrome } from './surface/useSurfaceChrome';
import type { SurfaceEnv } from './surface/registry';
import { scopeFindings } from './surface/scope';
import { stationOfRef } from './surface/stations';
import { Spine } from './surface/Spine';
import { SceneState, SceneStatus } from './surface/SceneState';
import { SurfaceFrame } from './surface/SurfaceStates';
import { EMPTY_GRAPH } from './emptyGraph';
import { useSurface } from './surface/useSurface';
import { useCompare } from './surface/useCompare';
import { useCompareActions } from './surface/useCompareActions';
import { RestructureContext } from './surface/useRestructure';
import type { EvidenceSide, KnowledgeConfirm, KnowledgeGraphSource, KnowledgePanelRenderer, LensId, EditorView, SourceLocation, SourceRange, ViewMode } from './types';

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
    /** Opens a finding's line range in the host's editor. Absent ⇒ ranges are links or text. */
    onOpenSource?(location: SourceLocation): void;
    /** What the host's editor shows of a file of the root on show: the code band follows it. */
    editorView?: EditorView | null;
}

const EMPTY_VISIBLE: VisibleGraph = { nodes: [], edges: [] };

export function KnowledgeGraphView({
    source, labels: partial, onCompose, initialFocus, openReview, initialLens, renderPanel, confirm, lenses: lensSubset, onOpenSource, editorView,
}: KnowledgeGraphViewProps) {
    const labels = useMemo(() => resolveLabels(partial), [partial]);
    // First-load triage: the graph's calls are timed (one wrapper per source), and the host's trace is read while a load runs.
    const timing = useTimedSource(source);
    const kg = useKnowledgeGraph(timing.source, {
        ...(initialLens ? { initialLens } : {}), ...(initialFocus ? { initialFocus } : {}), ...(lensSubset ? { lenses: lensSubset } : {}),
    });
    useFirstPaint(timing.timeline, kg.status, kg.stale, !!source.snapshot);
    const hostTrace = useHostLoadTrace(source, loadRunning(kg.status, kg.stale, kg.refreshFailed));
    const rootRef = useRef<HTMLElement>(null);
    const width = useContainerWidth(rootRef);
    const env = useRenderEnvironment();
    const [chosen, setMode] = useState<ViewMode | null>(null);
    const [showAll, setShowAll] = useState(false), [tracing, setTracing] = useState(false), [linesOpen, setLinesOpen] = useState(false);
    const targets = useReviewTargets(source); // read ONCE: the empty state's launcher uses it
    const sync = useSyncStatus(source, kg.rootId, kg.graph); // read ONCE: the pill, the banner and the Sync drawer share it
    const zoom = useZoomHost();

    // ONE compare state (PRD 43 C5): Before/After, a restructure and a picked commit all drive it. A two-graph comparison draws ONE union graph for its whole run.
    const history = useHistory(source, kg.rootId);
    const compare = useCompare({ source, rootId: kg.rootId, current: kg.graph, baseline: kg.baseline, commits: history.commits });
    const keepsBaseline = !!source.baseline || !!source.snapshot;
    const shown = compare.view?.graph ?? kg.graph;
    // null until a graph arrives; the frame is drawn regardless. The findings of stray copies are folded away (PRD 41 A9).
    const real = shown ? foldCopyFindings(shown) : shown;
    const graph = real ?? EMPTY_GRAPH;
    useGraphResident(real); // registered in this render so the cameras' subsets find it; posted to the worker early
    useGraphResident(kg.baseline?.graph ?? null); // the Before/After twin the surface also reads
    const side = compare.showingBefore ? 'baseline' as const : 'current' as const;
    const evidenceFor = useMemo(() => (source.evidence ? (f: Finding, s: EvidenceSide) => source.evidence!(f, s) : undefined), [source]);
    const evidenceOf = useMemo(() => (evidenceFor ? (f: Finding) => evidenceFor(f, side) : undefined), [evidenceFor, side]);
    const { lens, selected } = kg;
    // The commit scrubber: the commit picked marks the stations it changed (the "changed" question and metric); on the stage it is paint only.
    const changed = useMemo(() => new Set(compare.picked?.refs ?? []), [compare.picked]);
    const symbols = useMemo(() => (source.symbolsOf && kg.rootId ? (refs: string[]) => source.symbolsOf!(kg.rootId!, refs) : undefined), [source, kg.rootId]);
    const readSource = useMemo(() => (source.readSource && kg.rootId ? (path: string, range: SourceRange) => source.readSource!(kg.rootId!, path, range) : undefined), [source, kg.rootId]);
    const readSourceAt = useMemo(() => (source.readSourceAt && kg.rootId ? (path: string, rev: string, range: SourceRange) => source.readSourceAt!(kg.rootId!, path, rev, range) : undefined), [source, kg.rootId]);
    const surface = useSurface(graph, compare.showingBefore ? null : kg.baseline?.graph ?? null, { question: questionForLens(kg.requested.id), focus: kg.focus, changed, symbols, readSource, readSourceAt, editorView, repoConfigName: labels.surface.repoConfig, communityFallback: labels.communityFallback });
    // The question follows the lens in effect: a requested lens the graph cannot show falls back, and the pills must say which one is on.
    const lensInEffect = lens.id, lensAsked = kg.requested.id, setQuestion = surface.setQuestion;
    useEffect(() => {
        const q = questionForLens(lensInEffect);
        if (q && lensInEffect !== lensAsked) setQuestion(q);
    }, [lensInEffect, lensAsked, setQuestion]);
    const layout = useMemo(() => layoutOf(width), [width]);
    const compact = layout.compact;
    const surfaceEnv: SurfaceEnv = { webgl: env.webgl, reducedMotion: env.reducedMotion, hasLines: surface.lines.lines.length > 0, compact, hasRun: !!source.runs || !!source.review || keepsBaseline, hasAgentRuns: !!source.agentRuns, hasDomains: !!source.domains && !!source.organizeDomains };
    const cameras = CAMERAS.filter((c) => c.available(graph, surfaceEnv));
    const mode: ViewMode = cameras.find((c) => c.id === chosen)?.id ?? cameras.find((c) => c.id === 'transit')?.id ?? 'graph';
    // Selecting a node already inside the drawn set must not change the arrays the cameras key their layouts on.
    const focusKeep = useMemo(() => [...kg.focus, ...(selected ? [selected] : [])], [kg.focus, selected]);
    // Up to ~360 ms on a large graph: computed in the worker (in the same render for a small one), the previous drawn set staying until the new one lands.
    const focused = useComputed('focus', { graph, max: compact && !showAll ? PHONE_FOCUS_NODES : MAX_DRAWN_NODES, keep: focusKeep }, [graph, compact, showAll, focusKeep], EMPTY_VISIBLE, { inline: isSmall(graph), scope: [graph] }).value ?? EMPTY_VISIBLE;
    const visible = useStableGraph(focused);
    const drawn = useMemo(() => lensGraph(visible, lens), [visible, lens]);
    const index = useMemo(() => nodeIndex(graph), [graph]);
    const canApplyFor = useMemo(() => (source.applyFix ? (kind: string) => canApplyKind(source, kind) : false), [source]);
    // "What changed?" (PRD 38 P4): the files that usually change with the changed ones and are not touched yet.
    const changedPartners = useMemo(() => (surface.question === 'changed' ? partnersOf(graph, surface.changedFiles ?? []) : undefined), [surface.question, graph, surface.changedFiles]);
    const resolvedFixes = useMemo(() => new Set(Object.values(surface.fixFlows).filter(isResolved).map((f) => f.findingId)), [surface.fixFlows]);
    const diagnostics = () => graphDiagnostics({
        status: kg.status, rootId: kg.rootId, graph: real, drawn: { nodes: drawn.nodes.length, edges: drawn.edges.length },
        showAll, webgl: env.webgl, reducedMotion: env.reducedMotion, mode, width, compact, lens: lens.id,
        review: kg.review.state, lastPhase: kg.review.lastPhase, run: runRead.live, time: new Date().toISOString(),
        load: { timeline: timing.timeline.snapshot(), host: source.loadTrace ? hostTrace.latest() : undefined },
        // Called on click, after the render below has defined these.
        ...(real ? {
            surface: {
                graph: real, stations: surface.stations, lines: surface.lines, coverage: surface.coverage, scopeName: chrome.scopeName, scope: surface.scope,
                lensFindings: lensFindings(lens, real).length, listedFindings: listedFindings.length, queue: fixQueueCounts(findings, real.findings.length, resolvedFixes),
                sync: sync.status, lastReviewedAt: kg.scopes.find((x) => x.rootId === kg.rootId)?.lastReviewedAt, mapFrom: kg.scopes.find((x) => x.rootId === kg.rootId)?.serverOnly ? 'server-only' : source.mapSource,
            },
        } : {}),
    });
    const titleOf = (rootId: string) => kg.scopes.find((s) => s.rootId === rootId)?.title ?? rootId;
    // The ONE 3D / Flat switch (PRD 43 C4); Show in tower goes to 3D through it.
    const flatView = useFlatView();
    const { select, show, pickLens, pickQuestion, pinpointed, unpin, showInTower } = useSurfaceActions(kg, surface, () => setTracing(false), { ids: cameras.map((c) => c.id), set: setMode, setFlat: flatView.setFlat });
    useClearHighlightOutsideTower(mode, surface.towers, surface.setHighlight);
    // The open drawer is the surface's, so the header, the Act rail and the path strip all open one the same way.
    const panel = surface.panel;
    const reviewStatus = kg.review.state.status;
    // The Reviews panel (PRD 41 A8): its tab, run record, Retry upload and open / close rules are one hook.
    const { reviews, retryUpload, runRead, runs, setPanel, openReviews } = useReviewsPanel({ kg, surface, source, keepsBaseline, refreshSync: sync.refresh, openReview });
    // Exclude from review (PRD 41 A9): the host writes the ignore file, then the normal plan, estimate, confirm review starts.
    const copyFix = source.folders && kg.rootId
        ? { exclude: (copy: string) => source.folders!.exclude(kg.rootId!, copy), rereview: () => kg.review.start({ rootId: kg.rootId! }), busy: reviewStatus === 'planning' || reviewStatus === 'confirm' || reviewStatus === 'running' }
        : undefined;
    const chrome = useSurfaceChrome({
        kg, surface, graph, labels, layout, index, titleOf, select, cameras, mode, setMode, zoom: zoom.api, pickQuestion, pickLens, lens,
        visibleNodes: visible.nodes.length, showAll, setShowAll,
    });

    const s = labels.surface;
    const hasLines = surface.lines.lines.length > 0;
    // The Act findings are the graph's own, never filtered through a hidden view: scoped by the stations, then (only when a question is asked) by what it lit.
    const asking = surface.question !== 'where';
    const findings = useMemo(() => {
        const scoped = scopeFindings(graph.findings, surface.stations, surface.scope);
        return asking && surface.lit ? scopeFindings(scoped, surface.stations, surface.lit) : scoped;
    }, [graph.findings, surface.stations, surface.scope, surface.lit, asking]);
    // The Details list (the per-lens Insights aside) stays lens-scoped: the Act cards above it never are.
    // Scoped by the stations, then by the lens - never by what a question lit (the lens pick lights stations, and that must not empty its own list).
    const listedFindings = useMemo(
        () => scopeFindings(lensFindings(lens, graph), surface.stations, surface.scope),
        [lens, graph, surface.stations, surface.scope],
    );
    // The marks the map draws beyond the channels, so the legend can explain them.
    const legendExtras = useMemo(() => ({
        deadEnd: groupTermini(surface.lines.lines, surface.stations.byId, graph).some((t) => t.deadEnd),
        docs: docStations(graph, surface.stations).size > 0,
        types: typesPresent(surface.types.values()),
    }), [surface.lines, surface.stations, surface.types, graph]);
    const noHits = kg.hits && kg.hits.length === 0 ? kg.query : null;
    const linesPanel = (rail: boolean) => (
        <LinesPanel
            lines={surface.lines} stations={surface.stations} overlay={surface.overlay} labels={labels} lineId={surface.line?.id ?? null} rail={rail}
            selectedStation={surface.station?.id ?? null} onSelectLine={surface.selectLine} onSelectStation={surface.selectStation}
            coverage={surface.coverage} extras={legendExtras} kinds={mode === 'system' ? graph.findings.map((f) => f.kind) : undefined} findings={graph.findings}
        />
    );
    const panels = usePanelVisibility();
    // On the transit map "3D" means towers. The stage's tilt is driven by `flat` alone (useFlatTilt); `surface.towers` (the highlight, the legend)
    // is set in the SAME handler that changes `flat` - one commit, never a commit behind - and re-derived when the camera changes.
    const setTowers = surface.setTowers;
    const onFlat = (next: boolean) => {
        flatView.setFlat(next);
        if (mode === 'transit' || mode === 'map') setTowers(!next);
    };
    useEffect(() => { if (mode === 'transit' || mode === 'map') setTowers(!flatView.flat); }, [mode, flatView.flat, setTowers]);
    /** The stage's code pane has its own hide control (PRD 43 Part C1); its slot is remembered with the docks'. */
    const toggleCode = () => panels.toggle('code');
    // The ONE drawer: a panel opened from anywhere (`setPanel`) opens it at that tab; the header's Panels button opens it on Act.
    const drawer = useDrawer(panel, setPanel);
    const openSimulate = useOpenSimulate(surface, setPanel);
    const changedStations = new Set([...changed].flatMap((r) => stationOfRef(surface.stations, r) ?? [])).size;
    const actions = useCompareActions({ compare, current: kg.graph, graph, index, surface, symbols, labels, select, openSimulate });
    // The compare bar (the commit scrubber) shows only while "What changed?" is asked or a commit is picked.
    const showTime = surface.question === 'changed' || compare.picked !== null;
    const overlay = (
        <SceneOverlay
            {...chrome.overlayProps} flat={flatView.flat} onFlat={onFlat}
            time={showTime ? <TimeSlider commits={history.commits} capped={history.total} picked={compare.picked?.sha ?? null} labels={labels} changedStations={changedStations} onPick={(sha) => { compare.pickCommit(sha); if (sha) pickQuestion('changed'); }} onClose={() => { compare.pickCommit(null); pickQuestion('where'); }} /> : undefined}
        />
    );
    const leftDock = hasLines && !layout.phone && !layout.linesStacked;
    const stackLines = hasLines && layout.linesStacked && !layout.phone;

    return (
        <FlatViewContext.Provider value={flatView.setFlat}><RestructureContext.Provider value={actions.restructureFinding}><RetryUploadContext.Provider value={retryUpload}>
        <SurfaceFrame ref={rootRef} label={labels.regionLabel}>
            <SurfaceHeader
                kg={kg} source={source} labels={labels} graph={graph} surface={surface} env={surfaceEnv} wrapped={layout.drawerSheet} sync={sync.status}
                run={runRead.live} onOpenReviews={openReviews} outTo={chrome.out.to} onOut={chrome.out.onOut} drawerOpen={drawer.open} onToggleDrawer={drawer.toggle}
                panes={{ code: panels.visibility.code, onPane: (code) => { if (code !== panels.visibility.code) toggleCode(); } }}
                spine={<Spine labels={labels} items={chrome.spineItems} roots={{ scopes: kg.scopes, rootId: kg.rootId, onRoot: kg.selectRoot }} onPick={chrome.onSpinePick} />}
                askName={chrome.askName}
                linesToggle={layout.phone && hasLines ? <Pill on={linesOpen} aria-expanded={linesOpen} onClick={() => setLinesOpen((v) => !v)}>{s.linesButton}</Pill> : undefined}
                onSearch={(q) => void kg.search(q)} onSelect={select} onMatches={pinpointed} onClear={unpin} onCompose={onCompose}
            />
            {noHits !== null && <p role="status" style={{ ...muted, margin: 0, padding: '4px 12px' }}>{fillTemplate(labels.searchNoHits, { query: noHits })}</p>}
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
                <div style={{ display: 'flex', minWidth: 0, flex: 1, minHeight: 0 }}>
                    {leftDock && (
                        <DockEdge slot="left" shown={panels.visibility.left} onToggle={panels.toggle} labels={labels}>
                            {linesPanel(true)}
                        </DockEdge>
                    )}
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                        {layout.phone && overlay}{actions.bar}
                        <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
                            {/* Below the floating controls in every camera: `--kg-scene-top` is the measured height `SceneOverlay` publishes on this box (a phone stacks them in flow, so 0). */}
                            <div data-testid="kg-scene-box" style={{ position: 'absolute', top: layout.phone ? 0 : `var(--kg-scene-top, ${SCENE_TOP_FALLBACK})`, right: 0, bottom: 0, left: 0, overflow: 'auto' }}>
                                {real ? (
                                    <ZoomProvider host={zoom}>
                                        <ViewSurface
                                            mode={mode} graph={graph} drawn={drawn} lens={lens} labels={labels} rootTitle={titleOf(graph.scope.rootId)}
                                            selected={selected} focus={kg.focus} reducedMotion={env.reducedMotion} surface={surface} onSelect={select} onShow={show} onCamera={setMode}
                                            onCompose={onCompose} evidence={evidenceOf} onOpenSource={onOpenSource}
                                            codeShown={panels.visibility.code} onToggleCode={toggleCode} onSimulate={actions.onSimulate} onRestructure={actions.onRestructure} restructureLoading={actions.restructureStatus === 'loading'} compare={compare.view} flat={flatView.flat}
                                        />
                                    </ZoomProvider>
                                ) : (
                                    <SceneState status={kg.status} labels={labels} source={source} targets={targets} review={null} reviewStatus={kg.review.state.status} start={kg.review.start} openReview={openReview} onRetry={kg.reload}
                                        loading={{ phase: currentLoadPhase(hostTrace.trace, kg.rootId), diagnostics: () => diagnostics().text }}
                                        onSeed={kg.notHere?.canSeed && kg.rootId ? () => kg.review.start({ rootId: kg.rootId!, seed: true }) : undefined} onRun={kg.run} />
                                )}
                                <SceneStatus stale={kg.stale} refreshFailed={kg.refreshFailed} labels={labels} onRetry={kg.reload} onRun={real && !kg.running ? kg.run : undefined} />
                            </div>
                            {!layout.phone && overlay}
                            {surface.highlight && showsTowers(mode, surface.towers) && <TowerLegend highlight={surface.highlight} labels={labels} compact={layout.compact} onClose={() => surface.setHighlight(null)} />}
                        </div>
                        {stackLines && (
                            <DockEdge slot="left" shown={panels.visibility.left} onToggle={panels.toggle} labels={labels} below>
                                <div style={{ padding: 12, maxHeight: 260, overflow: 'auto', borderTop: `1px solid ${cssVar('border')}`, background: cssVar('panel') }}>{linesPanel(false)}</div>
                            </DockEdge>
                        )}
                        {hasLines && (
                            <PathStrip path={surface.path} step={surface.step} labels={labels} onStep={surface.setStep} pathTitle={chrome.pathTitle} stations={surface.stations.byId} />
                        )}
                    </div>
                </div>
                {real && (
                    <Drawer
                        drawer={drawer} sheet={layout.drawerSheet}
                        graph={graph} env={surfaceEnv} labels={labels} surface={surface} source={source} rootId={kg.rootId ?? undefined}
                        rootTitle={titleOf(graph.scope.rootId)} onChanged={kg.reload} diagnostics={diagnostics} sync={sync} history={history} runs={runs} reviews={reviews}
                        lastReviewedAt={kg.scopes.find((x) => x.rootId === kg.rootId)?.lastReviewedAt}
                        revision={keepsBaseline ? compare.revision : undefined}
                        onResendSkipped={source.review && kg.rootId ? () => { const id = kg.rootId!; setPanel(null); kg.review.start({ rootId: id, force: true }); } : undefined}
                        onCamera={setMode} cameras={cameras.map((c) => c.id)} onShow={show} onCompose={onCompose}
                        act={(
                            <ActPanel
                                graph={graph} findings={findings} listedFindings={listedFindings} lensName={labels.lenses[lens.id]} labels={labels} station={surface.station} stations={surface.stations.stations} scopeName={chrome.scopeName}
                                showFindings={mode !== 'list'} onClearScope={() => surface.selectLine(null)} onShow={show} onCompose={onCompose} onResolve={surface.resolve}
                                evidence={evidenceOf} onOpenSource={onOpenSource} canApply={canApplyFor} resolved={resolvedFixes} onOpenPanel={setPanel} path={surface.path} step={surface.step} pathTitle={chrome.pathTitle}
                                model={surface.stations} copyFix={copyFix} onAskUntested={() => pickQuestion('untested')} changedPartners={changedPartners}
                            >
                                <InsightsPanel graph={graph} labels={labels} lenses={kg.lenses.map((l) => l.id)} onLens={pickLens} onShow={show} findingKinds={mode !== 'list'} />
                                <LensPanel graph={graph} lens={lens} requested={kg.requested} baseline={kg.baseline} current={kg.graph} labels={labels} evidence={evidenceFor} onOpenSource={onOpenSource} />
                            </ActPanel>
                        )}
                    />
                )}
            </div>
            {layout.phone && hasLines && <Sheet open={linesOpen} compact title={s.linesTitle} closeLabel={labels.close} onClose={() => setLinesOpen(false)}>{linesPanel(false)}</Sheet>}
            <NodeSheet
                graph={graph} index={index} selected={selected} tracing={tracing} labels={labels} source={source} confirm={confirm} renderPanel={renderPanel}
                compact={layout.compact} onClose={() => { setTracing(false); kg.select(null); }} onTrace={() => setTracing((v) => !v)} onSelect={select} onChanged={kg.reload} onShow={show}
                onResolve={surface.resolve}
                onShowInTower={showInTower}
            />
        </SurfaceFrame>
        </RetryUploadContext.Provider></RestructureContext.Provider></FlatViewContext.Provider>
    );
}

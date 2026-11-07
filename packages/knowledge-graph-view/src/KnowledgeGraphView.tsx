/**
 * `KnowledgeGraphView` — the ONE view of a knowledge graph, on every host (PRD 38 §4.6).
 *
 * A composition root: it holds the graph's state and the surface's state, and lays out the
 * parts, each its own module. Header (`surface/SurfaceHeader.tsx`: the status strip, then the
 * spine, ask bar, Panels and overlays); left, the lines and their stations; centre, the scene
 * with its floating controls (`surface/SceneOverlay.tsx`) and the path strip below; right, the
 * Act panel. The cameras and the panels are registries (`surface/cameras.tsx`,
 * `surface/panels.ts`), so this file names none of them. What the chrome derives from the state
 * (the layout steps, the spine, the titles, the overlay's props) is `surface/useSurfaceChrome.ts`.
 *
 * The rails reflow by container width (`layout.ts`): below 1100px the Act rail moves under the
 * scene; below 840px the Lines list stacks above the path strip; below the phone width it is a
 * sheet. With no reviewed folder it offers **Review a folder**.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Finding } from '@seanhogg/builderforce-memory/knowledge';
import { resolveLabels, fillTemplate, type KnowledgeGraphLabels } from './labels';
import { useKnowledgeGraph } from './useKnowledgeGraph';
import { graphDiagnosticsText } from './graphDiagnostics';
import { lensFindings } from './lenses';
import { PHONE_FOCUS_NODES, focusGraph, lensGraph, nodeIndex } from './graphModel';
import { useContainerWidth, useRenderEnvironment } from './environment';
import { layoutOf } from './layout';
import type { Revision } from './revision';
import { ReviewProgress } from './ReviewProgress';
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
import { SceneOverlay } from './surface/SceneOverlay';
import { useSyncStatus } from './surface/useSyncStatus';
import { useReviewRunRecord } from './surface/run/useReviewRunRecord';
import { useZoomHost, ZoomProvider } from './surface/zoom';
import { LinesPanel } from './surface/LinesPanel';
import { foldCopyFindings } from './surface/systems';
import { PanelDrawer } from './surface/PanelDock';
import { canApplyKind } from './surface/codemods';
import { isResolved } from './surface/fix/fixFlow';
import { fixQueueCounts } from './surface/fix/fixModes';
import { docStations } from './surface/transit/docs';
import { groupTermini } from './surface/transit/termini';
import { PathStrip } from './surface/PathStrip';
import { hopRouteLabels } from './surface/sequenceText';
import { SurfaceHeader } from './surface/SurfaceHeader';
import { useHistory } from './surface/TimeSlider';
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
    /** Opens a finding's line range in the host's editor. Absent ⇒ ranges are links or text. */
    onOpenSource?(location: SourceLocation): void;
}

export function KnowledgeGraphView({
    source, labels: partial, onCompose, initialFocus, openReview, initialLens, renderPanel, confirm, lenses: lensSubset, onOpenSource,
}: KnowledgeGraphViewProps) {
    const labels = useMemo(() => resolveLabels(partial), [partial]);
    const kg = useKnowledgeGraph(source, {
        ...(initialLens ? { initialLens } : {}), ...(initialFocus ? { initialFocus } : {}), ...(lensSubset ? { lenses: lensSubset } : {}),
    });
    const rootRef = useRef<HTMLElement>(null);
    const width = useContainerWidth(rootRef);
    const env = useRenderEnvironment();
    const [chosen, setMode] = useState<ViewMode | null>(null);
    const [showAll, setShowAll] = useState(false), [tracing, setTracing] = useState(false), [linesOpen, setLinesOpen] = useState(false);
    const [revision, setRevision] = useState<Revision>('after');
    const targets = useReviewTargets(source); // read ONCE: the ⋯ menu and the empty state's launcher share it
    const sync = useSyncStatus(source, kg.rootId, kg.graph); // read ONCE: the pill, the banner and the Sync drawer share it
    const zoom = useZoomHost();

    // Before/After: offered when the host keeps a baseline; "before" draws the baseline graph.
    const keepsBaseline = !!source.baseline || !!source.snapshot;
    const showingBefore = revision === 'before' && !!kg.baseline;
    const shown = showingBefore ? kg.baseline!.graph : kg.graph;
    // null until a graph arrives; the frame is drawn regardless. The findings of stray copies are folded away (PRD 41 A9).
    const real = shown ? foldCopyFindings(shown) : shown;
    const graph = real ?? EMPTY_GRAPH;
    const side = showingBefore ? 'baseline' as const : 'current' as const;
    const evidenceFor = useMemo(() => (source.evidence ? (f: Finding, s: EvidenceSide) => source.evidence!(f, s) : undefined), [source]);
    const evidenceOf = useMemo(() => (evidenceFor ? (f: Finding) => evidenceFor(f, side) : undefined), [evidenceFor, side]);
    const { lens, selected } = kg;
    // The commit scrubber: the commit picked marks the stations it changed (the "changed" question and metric).
    const history = useHistory(source, kg.rootId);
    const [picked, setPicked] = useState<string | null>(null);
    useEffect(() => setPicked(null), [kg.rootId]);
    const changed = useMemo(() => new Set(history.commits.find((c) => c.sha === picked)?.refs ?? []), [history, picked]);
    const symbols = useMemo(() => (source.symbolsOf && kg.rootId ? (refs: string[]) => source.symbolsOf!(kg.rootId!, refs) : undefined), [source, kg.rootId]);
    const surface = useSurface(graph, showingBefore ? null : kg.baseline?.graph ?? null, { question: questionForLens(kg.requested.id), focus: kg.focus, changed, symbols, repoConfigName: labels.surface.repoConfig });
    // The question follows the lens in effect: a requested lens the graph cannot show falls back, and the pills must say which one is on.
    const lensInEffect = lens.id, lensAsked = kg.requested.id, setQuestion = surface.setQuestion;
    useEffect(() => {
        const q = questionForLens(lensInEffect);
        if (q && lensInEffect !== lensAsked) setQuestion(q);
    }, [lensInEffect, lensAsked, setQuestion]);
    const layout = useMemo(() => layoutOf(width), [width]);
    const compact = layout.compact;
    const surfaceEnv: SurfaceEnv = { webgl: env.webgl, reducedMotion: env.reducedMotion, hasLines: surface.lines.lines.length > 0, compact, hasSync: !!source.syncStatus, hasRun: !!source.runs };
    const cameras = CAMERAS.filter((c) => c.available(graph, surfaceEnv));
    const mode: ViewMode = cameras.find((c) => c.id === chosen)?.id ?? cameras.find((c) => c.id === 'transit')?.id ?? 'graph';
    const visible = useMemo(() => focusGraph(graph, compact && !showAll ? PHONE_FOCUS_NODES : MAX_DRAWN_NODES, [...kg.focus, ...(selected ? [selected] : [])]), [graph, compact, showAll, kg.focus, selected]);
    const drawn = useMemo(() => lensGraph(visible, lens), [visible, lens]);
    const index = useMemo(() => nodeIndex(graph), [graph]);
    const canApplyFor = useMemo(() => (source.applyFix ? (kind: string) => canApplyKind(source, kind) : false), [source]);
    const resolvedFixes = useMemo(() => new Set(Object.values(surface.fixFlows).filter(isResolved).map((f) => f.findingId)), [surface.fixFlows]);
    const routeLabels = useMemo(() => hopRouteLabels(surface.path, surface.stations.byId, index), [surface.path, surface.stations.byId, index]);
    const diagnosticsText = () => graphDiagnosticsText({
        status: kg.status, rootId: kg.rootId, graph: real, drawn: { nodes: drawn.nodes.length, edges: drawn.edges.length },
        showAll, webgl: env.webgl, reducedMotion: env.reducedMotion, mode, width, compact, lens: lens.id,
        review: kg.review.state, lastPhase: kg.review.lastPhase, run: runRead.live, time: new Date().toISOString(),
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
    const { select, show, pickLens, pickQuestion, pinpointed, unpin } = useSurfaceActions(kg, surface, () => setTracing(false));
    // The open drawer is the surface's, so the header, the Act rail and the path strip all open one the same way.
    const panel = surface.panel, setPanel = surface.openPanel;
    // The review as a run (PRD 41 A8): its record is read once here; any review that is confirmed opens the Run drawer.
    const runRead = useReviewRunRecord(source, kg.rootId, panel === 'run');
    const runs = source.runs ? { read: runRead, review: kg.review } : undefined;
    const openRun = useRef(setPanel);
    openRun.current = setPanel;
    const reviewStatus = kg.review.state.status;
    // Exclude from review (PRD 41 A9): the host writes the ignore file, then the normal plan, estimate, confirm review starts.
    const copyFix = source.folders && kg.rootId
        ? { exclude: (copy: string) => source.folders!.exclude(kg.rootId!, copy), rereview: () => kg.review.start({ rootId: kg.rootId! }), busy: reviewStatus === 'planning' || reviewStatus === 'confirm' || reviewStatus === 'running' }
        : undefined;
    // Opened when the run starts (after the plan is confirmed), never over the confirm card.
    useEffect(() => { if (reviewStatus === 'running' && source.runs) openRun.current('run'); }, [reviewStatus, source.runs]);
    const chrome = useSurfaceChrome({
        kg, surface, graph, labels, layout, index, titleOf, select, cameras, mode, setMode, zoom: zoom.api, pickQuestion, pickLens, lens,
        visibleNodes: visible.nodes.length, showAll, setShowAll, sync: sync.status,
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
    }), [surface.lines, surface.stations, graph]);
    const noHits = kg.hits && kg.hits.length === 0 ? kg.query : null;
    const linesPanel = (rail: boolean) => (
        <LinesPanel
            lines={surface.lines} stations={surface.stations} overlay={surface.overlay} labels={labels} lineId={surface.line?.id ?? null} rail={rail}
            selectedStation={surface.station?.id ?? null} onSelectLine={surface.selectLine} onSelectStation={surface.selectStation}
            coverage={surface.coverage} extras={legendExtras} kinds={mode === 'system' ? graph.findings.map((f) => f.kind) : undefined} findings={graph.findings}
        />
    );
    const overlay = <SceneOverlay {...chrome.overlayProps} />;
    const stackLines = hasLines && layout.linesStacked && !layout.phone;

    return (
        <SurfaceFrame ref={rootRef} label={labels.regionLabel}>
            <SurfaceHeader
                kg={kg} source={source} labels={labels} graph={graph} hasGraph={!!real} surface={surface} env={surfaceEnv} narrow={layout.phone} sync={sync.status}
                panelsMenu={layout.panelsMenu} targets={targets}
                spine={<Spine labels={labels} items={chrome.spineItems} roots={{ scopes: kg.scopes, rootId: kg.rootId, onRoot: kg.selectRoot }} onPick={chrome.onSpinePick} />}
                reviewCard={<ReviewProgress run={kg.review} labels={labels} titleOf={titleOf} onContinue={(rootId) => kg.review.start({ rootId })} onDetails={runs ? () => setPanel('run') : undefined} />}
                panel={panel} onPanel={setPanel} history={history} pickedCommit={picked}
                onPickCommit={(sha) => { setPicked(sha); if (sha) pickQuestion('changed'); }}
                changedStations={new Set([...changed].flatMap((r) => stationOfRef(surface.stations, r) ?? [])).size}
                revision={keepsBaseline ? { value: showingBefore ? 'before' : 'after', hasBefore: !!kg.baseline, onChange: setRevision } : undefined}
                diagnosticsText={diagnosticsText} askName={chrome.askName}
                linesToggle={layout.phone && hasLines ? <Pill on={linesOpen} aria-expanded={linesOpen} onClick={() => setLinesOpen((v) => !v)}>{s.linesButton}</Pill> : undefined}
                onSearch={(q) => void kg.search(q)} onSelect={select} onMatches={pinpointed} onClear={unpin} onCompose={onCompose} openReview={openReview}
            />
            {noHits !== null && <p role="status" style={{ ...muted, margin: 0, padding: '4px 12px' }}>{fillTemplate(labels.searchNoHits, { query: noHits })}</p>}
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: layout.actBelow ? 'column' : 'row', overflow: layout.actBelow ? 'auto' : 'hidden' }}>
                <div style={{ display: 'flex', minWidth: 0, ...(layout.actBelow ? { flex: 'none' } : { flex: 1, minHeight: 0 }) }}>
                    {hasLines && !layout.linesStacked && linesPanel(true)}
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                        {layout.phone && overlay}
                        <div style={{ position: 'relative', flex: 1, minHeight: layout.actBelow ? 320 : 0 }}>
                            {/* Below the floating controls in every camera: `--kg-scene-top` is the measured height `SceneOverlay` publishes on this box (a phone stacks them in flow, so 0). */}
                            <div data-testid="kg-scene-box" style={{ position: 'absolute', top: layout.phone ? 0 : 'var(--kg-scene-top, 88px)', right: 0, bottom: 0, left: 0, overflow: 'auto' }}>
                                {real ? (
                                    <ZoomProvider host={zoom}>
                                        <ViewSurface
                                            mode={mode} graph={graph} drawn={drawn} lens={lens} labels={labels} rootTitle={titleOf(graph.scope.rootId)}
                                            selected={selected} focus={kg.focus} reducedMotion={env.reducedMotion} surface={surface} onSelect={select} onShow={show} onCamera={setMode}
                                            onCompose={onCompose} evidence={evidenceOf} onOpenSource={onOpenSource}
                                        />
                                    </ZoomProvider>
                                ) : (
                                    <SceneState status={kg.status} labels={labels} source={source} targets={targets} review={null} reviewStatus={kg.review.state.status} start={kg.review.start} openReview={openReview} onRetry={kg.reload}
                                        onSeed={kg.notHere?.canSeed && kg.rootId ? () => kg.review.start({ rootId: kg.rootId!, seed: true }) : undefined} />
                                )}
                                <SceneStatus stale={kg.stale} refreshFailed={kg.refreshFailed} labels={labels} onRetry={kg.reload} />
                            </div>
                            {!layout.phone && overlay}
                        </div>
                        {stackLines && <div style={{ padding: 12, maxHeight: 260, overflow: 'auto', borderTop: `1px solid ${cssVar('border')}`, background: cssVar('panel') }}>{linesPanel(false)}</div>}
                        {hasLines && (
                            <PathStrip
                                path={surface.path} step={surface.step} labels={labels} onStep={surface.setStep} pathTitle={chrome.pathTitle}
                                stations={surface.stations.byId} routeLabels={routeLabels} onOpenPanel={setPanel} onEnlarge={() => setMode('sequence')} narrow={layout.phone}
                            />
                        )}
                    </div>
                </div>
                {real && <ActPanel
                    graph={graph} findings={findings} listedFindings={listedFindings} lensName={labels.lenses[lens.id]} labels={labels} station={surface.station} stations={surface.stations.stations} scopeName={chrome.scopeName}
                    compact={layout.actBelow} showFindings={mode !== 'list'} onClearScope={() => surface.selectLine(null)} onShow={show} onCompose={onCompose} onResolve={surface.resolve}
                    evidence={evidenceOf} onOpenSource={onOpenSource} canApply={canApplyFor} resolved={resolvedFixes} onOpenPanel={setPanel} path={surface.path} pathTitle={chrome.pathTitle}
                    model={surface.stations} copyFix={copyFix} onAskUntested={() => pickQuestion('untested')}
                >
                    <InsightsPanel graph={graph} labels={labels} lenses={kg.lenses.map((l) => l.id)} onLens={pickLens} onShow={show} findingKinds={mode !== 'list'} />
                    <LensPanel graph={graph} lens={lens} requested={kg.requested} baseline={kg.baseline} current={kg.graph} labels={labels} evidence={evidenceFor} onOpenSource={onOpenSource} />
                </ActPanel>}
            </div>
            {layout.phone && hasLines && <Sheet open={linesOpen} compact title={s.linesTitle} closeLabel={labels.close} onClose={() => setLinesOpen(false)}>{linesPanel(false)}</Sheet>}
            <PanelDrawer
                graph={graph} env={surfaceEnv} labels={labels} surface={surface} panel={panel} onPanel={setPanel} renderPanel={renderPanel} source={source} rootId={kg.rootId ?? undefined}
                rootTitle={titleOf(graph.scope.rootId)} onChanged={kg.reload} diagnosticsText={diagnosticsText} sync={sync} history={history} runs={runs}
                lastReviewedAt={kg.scopes.find((x) => x.rootId === kg.rootId)?.lastReviewedAt}
                revision={keepsBaseline ? { value: showingBefore ? 'before' : 'after', hasBefore: !!kg.baseline, onChange: setRevision } : undefined}
                onResendSkipped={source.review && kg.rootId ? () => { const id = kg.rootId!; setPanel(null); kg.review.start({ rootId: id, force: true }); } : undefined}
                onCamera={setMode} cameras={cameras.map((c) => c.id)} onShow={show} onCompose={onCompose}
            />
            <NodeSheet
                graph={graph} index={index} selected={selected} tracing={tracing} labels={labels} source={source} confirm={confirm} renderPanel={renderPanel}
                compact={layout.compact} onClose={() => { setTracing(false); kg.select(null); }} onTrace={() => setTracing((v) => !v)} onSelect={select} onChanged={kg.reload} onShow={show}
            />
        </SurfaceFrame>
    );
}

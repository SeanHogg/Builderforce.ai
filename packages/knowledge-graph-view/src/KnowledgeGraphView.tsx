/**
 * `KnowledgeGraphView` — the ONE view of a knowledge graph, on every host (PRD 38 §4.6).
 *
 * A composition root: it holds the graph's state and the surface's state, and lays out the
 * parts, each its own module. Header (spine, ask bar, panel buttons, overlays); left, the
 * lines and their stations; centre, the camera switcher, the question chips and the scene,
 * with the path strip below; right, the Act panel. The cameras and the panel buttons are
 * registries (`surface/cameras.tsx`, `surface/panels.ts`), so this file names none of them.
 *
 * Compact: panels stack under the scene, the node is a bottom sheet; below `PHONE_WIDTH` the
 * left panel is a sheet too. With no reviewed folder it offers **Review a folder**.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
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
import { LensPanel } from './LensPanel';
import { InsightsPanel } from './insights/InsightsPanel';
import { NodeSheet } from './NodeSheet';
import { SurfaceNotes } from './SurfaceNotes';
import { Sheet } from './Sheet';
import { chip, quietButton } from './styles';
import { CAMERAS } from './surface/cameras';
import { ActPanel } from './surface/ActPanel';
import { CameraBar } from './surface/CameraBar';
import { LinesPanel } from './surface/LinesPanel';
import { OverlayMenu } from './surface/OverlayMenu';
import { PanelDock } from './surface/PanelDock';
import { PathStrip } from './surface/PathStrip';
import { PinpointInput } from './surface/PinpointInput';
import { TimeSlider, useHistory } from './surface/TimeSlider';
import { buildSpine } from './surface/path';
import { questionForLens } from './surface/questions';
import { useSurfaceActions } from './surface/useSurfaceActions';
import type { SurfaceEnv } from './surface/registry';
import { scopeFindings } from './surface/scope';
import { stationOfRef } from './surface/stations';
import { Spine } from './surface/Spine';
import { SceneState, SceneStatus } from './surface/SceneState';
import { SurfaceFrame } from './surface/SurfaceStates';
import { EMPTY_GRAPH } from './emptyGraph';
import { useSurface } from './surface/useSurface';
import type { Finding } from '@seanhogg/builderforce-memory/knowledge';
import type { EvidenceSide, KnowledgeConfirm, KnowledgeGraphSource, KnowledgePanelRenderer, LensId, SourceLocation, ViewMode } from './types';

/** Nodes a desktop view draws at most (instanced geometry is sized for it). */
const MAX_DRAWN_NODES = 2000;
/** Below this container width the left panel collapses into a sheet. */
const PHONE_WIDTH = 480;

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
    const phone = width > 0 && width < PHONE_WIDTH;
    const env = useRenderEnvironment();
    const [chosen, setMode] = useState<ViewMode | null>(null);
    const [showAll, setShowAll] = useState(false), [tracing, setTracing] = useState(false), [linesOpen, setLinesOpen] = useState(false);
    const [revision, setRevision] = useState<Revision>('after');
    const diagCopy = useCopyText(); // the bug-report capture (English on purpose — see reviewDiagnostics.ts)

    // Before/After: offered when the host keeps a baseline; "before" draws the baseline graph.
    const keepsBaseline = !!source.baseline || !!source.snapshot;
    const showingBefore = revision === 'before' && !!kg.baseline;
    const real = showingBefore ? kg.baseline!.graph : kg.graph; // null until a graph arrives; the frame is drawn regardless
    const graph = real ?? EMPTY_GRAPH;
    const side = showingBefore ? 'baseline' as const : 'current' as const;
    const evidenceFor = useMemo(() => (source.evidence ? (f: Finding, s: EvidenceSide) => source.evidence!(f, s) : undefined), [source]);
    const evidenceOf = useMemo(() => (evidenceFor ? (f: Finding) => evidenceFor(f, side) : undefined), [evidenceFor, side]);
    const { lens, selected } = kg;
    // The time slider: the commit picked marks the stations it changed (the "changed" question and metric).
    const commits = useHistory(source, kg.rootId);
    const [picked, setPicked] = useState<string | null>(null);
    useEffect(() => setPicked(null), [kg.rootId]);
    const changed = useMemo(() => new Set(commits.commits.find((c) => c.sha === picked)?.refs ?? []), [commits, picked]);
    const surface = useSurface(graph, showingBefore ? null : kg.baseline?.graph ?? null, { question: questionForLens(kg.requested.id), focus: kg.focus, changed });
    const surfaceEnv: SurfaceEnv = { webgl: env.webgl, reducedMotion: env.reducedMotion, hasLines: surface.lines.lines.length > 0, compact, hasSync: !!source.syncStatus };
    const cameras = graph ? CAMERAS.filter((c) => c.available(graph, surfaceEnv)) : [];
    const mode: ViewMode = cameras.find((c) => c.id === chosen)?.id ?? cameras.find((c) => c.id === 'transit')?.id ?? 'graph';
    const visible = useMemo(() => {
        if (!graph) return null;
        const keep = [...kg.focus, ...(selected ? [selected] : [])];
        return focusGraph(graph, compact && !showAll ? PHONE_FOCUS_NODES : MAX_DRAWN_NODES, keep);
    }, [graph, compact, showAll, kg.focus, selected]);
    const drawn = useMemo(() => (visible ? lensGraph(visible, lens) : null), [visible, lens]);
    const index = useMemo(() => nodeIndex(graph ?? { nodes: [] }), [graph]);
    const diagnosticsText = () => graphDiagnosticsText({
        status: kg.status, rootId: kg.rootId, graph: real, drawn: drawn ? { nodes: drawn.nodes.length, edges: drawn.edges.length } : null,
        showAll, webgl: env.webgl, reducedMotion: env.reducedMotion, mode, width, compact, lens: lens.id,
        review: kg.review.state, lastPhase: kg.review.lastPhase, time: new Date().toISOString(),
    });
    const titleOf = (rootId: string) => kg.scopes.find((s) => s.rootId === rootId)?.title ?? rootId;
    const { select, show, pickLens, pickQuestion, pinpointed, unpin } = useSurfaceActions(kg, surface, () => setTracing(false));

    const review = <ReviewProgress run={kg.review} labels={labels} titleOf={titleOf} onContinue={(rootId) => kg.review.start({ rootId })} />;
    if (!visible || !drawn) return null; // unreachable: `graph` is never null (EMPTY_GRAPH stands in); narrows the memos

    const s = labels.surface;
    const hasLines = surface.lines.lines.length > 0;
    const findings = scopeFindings(lensFindings(lens, graph), surface.stations, surface.scope);
    const truncated = graph.stats.truncated || visible.nodes.length < graph.nodes.length;
    const selectedNode = selected ? index.get(selected) ?? null : null;
    const spineStation = surface.station ?? (selected ? surface.stations.byId.get(stationOfRef(surface.stations, selected) ?? '') ?? null : null);
    const scopeName = surface.station ? surface.station.name : surface.lineChosen && surface.line ? fillTemplate(s.lineName, { name: surface.line.name }) : null;
    const linesPanel = (
        <LinesPanel
            lines={surface.lines} stations={surface.stations} overlay={surface.overlay} labels={labels} lineId={surface.line?.id ?? null}
            selectedStation={surface.station?.id ?? null} onSelectLine={surface.selectLine} onSelectStation={surface.selectStation}
        />
    );

    return (
        <SurfaceFrame ref={rootRef} label={labels.regionLabel}>
            <Toolbar
                labels={labels} scopes={kg.scopes} rootId={kg.rootId} onRoot={kg.selectRoot} onSearch={(q) => void kg.search(q)}
                spine={(
                    <Spine
                        labels={labels} items={buildSpine({ rootTitle: titleOf(graph.scope.rootId), station: spineStation, node: selectedNode, nodeLabel: (r) => labelFor(index, r) })}
                        onPick={(item) => {
                            if (item.kind === 'root') { kg.select(null); surface.selectStation(null); } else if (item.kind === 'station') kg.select(null); else if (item.id) select(item.id);
                        }}
                    />
                )}
                askWrap={(form) => (
                    <PinpointInput
                        source={source} rootId={kg.rootId} graph={graph} stations={surface.stations} labels={labels} onSelect={select} onCompose={onCompose}
                        onMatches={pinpointed} onClear={unpin}
                    >
                        {form}
                    </PinpointInput>
                )}
                time={<TimeSlider commits={commits.commits} capped={commits.total} picked={picked} labels={labels} onPick={setPicked} changedStations={new Set([...changed].flatMap((r) => stationOfRef(surface.stations, r) ?? [])).size} />}
                panels={(
                    <PanelDock
                        graph={graph} env={surfaceEnv} labels={labels} surface={surface} renderPanel={renderPanel} source={source} rootId={kg.rootId ?? undefined}
                        rootTitle={titleOf(graph.scope.rootId)} onChanged={kg.reload} diagnosticsText={diagnosticsText} onCamera={setMode} cameras={cameras.map((c) => c.id)} onShow={show} onCompose={onCompose}
                    />
                )}
                overlays={(
                    <OverlayMenu
                        labels={labels} stations={surface.stations.stations} bindings={surface.overlay.bindings} preset={surface.preset}
                        onPreset={surface.setPreset} onChannel={surface.setChannel} onPins={surface.setPins}
                    />
                )}
                linesToggle={phone && hasLines ? <button type="button" aria-expanded={linesOpen} style={chip(linesOpen)} onClick={() => setLinesOpen((v) => !v)}>{s.linesButton}</button> : undefined}
                {...(keepsBaseline ? { revision: { value: (showingBefore ? 'before' : 'after') as Revision, hasBefore: !!kg.baseline, onChange: setRevision } } : {})}
                actions={(
                    <>
                        {/* with no graph the scene's empty card is the ONE review action (a failed read has none, so the toolbar keeps it) */}
                        {(real || kg.status === 'load-failed' || kg.status === 'error') && <ReviewLauncher source={source} labels={labels} start={(req) => kg.review.start(req.target || req.pick ? req : kg.rootId ? { rootId: kg.rootId } : {})} primary={false} defaultOpen={!!openReview} status={kg.review.state.status} />}
                        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                            <button type="button" style={{ ...quietButton, minHeight: 32 }} onClick={() => void diagCopy.copy(diagnosticsText())}>{labels.copyDiagnostics}</button>
                            <CopiedNote status={diagCopy.status} labels={labels} />
                        </span>
                    </>
                )}
            />
            <CameraBar
                labels={labels} cameras={cameras} mode={mode} onMode={setMode} stations={surface.stations.stations} question={surface.question} onQuestion={pickQuestion}
                litCount={surface.lit ? surface.lit.size : null} lenses={kg.lenses} lens={lens.id} onLens={pickLens} lensControl={lensControl}
            />
            <SurfaceNotes
                labels={labels} review={review} stats={graph.stats} truncated={truncated} compact={compact} showAll={showAll}
                drawn={visible.nodes.length} total={graph.nodes.length} noHits={kg.hits && kg.hits.length === 0 ? kg.query : null} onShowAll={() => setShowAll(true)}
            />
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: compact ? 'column' : 'row', overflow: compact ? 'auto' : 'hidden' }}>
                {hasLines && !phone && <div style={{ width: compact ? 'auto' : 260, flex: 'none', overflow: 'auto', padding: 12 }}>{linesPanel}</div>}
                <div style={{ flex: 1, minWidth: 0, minHeight: compact ? 320 : 0, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'auto' }}>
                        {real ? (
                            <ViewSurface
                                mode={mode} graph={graph} drawn={drawn} lens={lens} labels={labels} rootTitle={titleOf(graph.scope.rootId)}
                                selected={selected} focus={kg.focus} reducedMotion={env.reducedMotion} surface={surface} onSelect={select} onShow={show}
                                onCompose={onCompose} evidence={evidenceOf} onOpenSource={onOpenSource}
                            />
                        ) : (
                            <SceneState status={kg.status} labels={labels} source={source} review={null} reviewStatus={kg.review.state.status} start={kg.review.start} openReview={openReview} onRetry={kg.reload} />
                        )}
                        <SceneStatus stale={kg.stale} refreshFailed={kg.refreshFailed} labels={labels} onRetry={kg.reload} />
                    </div>
                    {hasLines && <PathStrip path={surface.path} step={surface.step} labels={labels} onStep={surface.setStep} />}
                </div>
                {real && <ActPanel
                    graph={graph} findings={findings} labels={labels} station={surface.station} stations={surface.stations.stations} scopeName={scopeName}
                    compact={compact} showFindings={mode !== 'list'} onClearScope={() => surface.selectLine(null)} onShow={show} onCompose={onCompose} onResolve={surface.resolve}
                    evidence={evidenceOf} onOpenSource={onOpenSource}
                >
                    <InsightsPanel graph={graph} labels={labels} lenses={kg.lenses.map((l) => l.id)} onLens={pickLens} onShow={show} findingKinds={mode !== 'list'} />
                    <LensPanel graph={graph} lens={lens} requested={kg.requested} baseline={kg.baseline} current={kg.graph} labels={labels} evidence={evidenceFor} onOpenSource={onOpenSource} />
                </ActPanel>}
            </div>
            {phone && hasLines && <Sheet open={linesOpen} compact title={s.linesTitle} closeLabel={labels.close} onClose={() => setLinesOpen(false)}>{linesPanel}</Sheet>}
            <NodeSheet
                graph={graph} index={index} selected={selected} tracing={tracing} labels={labels} source={source} confirm={confirm} renderPanel={renderPanel}
                compact={compact} onClose={() => { setTracing(false); kg.select(null); }} onTrace={() => setTracing((v) => !v)} onSelect={select} onChanged={kg.reload}
            />
        </SurfaceFrame>
    );
}

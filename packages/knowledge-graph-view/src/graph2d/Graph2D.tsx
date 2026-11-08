/**
 * The 2D graph — the default view. Partitions are horizontal bands (top-down by flow), a
 * node is a circle sized by importance and toned by the active lens, edges are ONE path per
 * tone. Wheel/pinch zoom, drag pans; a node is a button with a thumb-sized hit target. Tab
 * stops are the most important nodes (plus the selection), arrow keys walk the rest in
 * importance order. Labels are drawn only for the selection, its neighbours and the top few
 * nodes. Each layer is memoised on props that do not change while panning, so a drag moves
 * the viewBox and re-renders nothing.
 */

import { memo, useCallback, useEffect, useMemo, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import type { KEdge, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import type { LensDef } from '../lenses';
import { useContainerSize } from '../environment';
import { byImportance } from '../graphModel';
import { useDeferredWhen } from '../useDeferredWhen';
import { useIdleSteps } from '../useIdleSteps';
import { DEFER_EDGES_ABOVE, incidentOf, pickEdges } from '../scene/edgeBudget';
import { useRankedEdges } from '../scene/useRankedEdges';
import { LayingOut } from '../surface/LayingOut';
import { usePanZoom } from '../usePanZoom';
import { useRoving } from '../useRoving';
import { HIT_PX, useSvgScale } from '../useSvgScale';
import { nearestHit } from '../hitTest';
import { usePanZoomRegistration } from '../surface/zoom';
import { kindLabel } from '../names';
import { groupEdges, type EdgeGroup } from '../scene/buffers';
import { cssVar, type ThemeTone } from '../scene/themeColors';
import { EMPTY_LAYOUT_2D, fitView, layout2dTask, nodeRadius, type Layout2D } from './layout2d';

/** Nodes labelled by default (besides the selection and its neighbours), and nodes that are Tab stops. */
export const LABELLED_NODES = 25;
export const TAB_STOPS = 25;

export interface Graph2DProps {
    rootId: string;
    nodes: readonly KNode[];
    edges: readonly KEdge[];
    lens: LensDef;
    selected: string | null;
    onSelect(ref: string): void;
    /** Band captions: a partition name, or the host's word for "none". */
    planeLabel(partition: string): string;
    labels: KnowledgeGraphLabels;
    label: string;
}

const segments = (pairs: ReadonlyArray<readonly [readonly [number, number], readonly [number, number]]>): string =>
    pairs.map(([a, b]) => `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`).join('');

const Bands = memo(function Bands({ layout, font, planeLabel }: { layout: Layout2D; font: number; planeLabel(p: string): string }) {
    return (
        <>
            {layout.bands.map((b) => (
                <g key={b.partition} data-band={b.partition}>
                    <rect x={layout.bounds.minX} y={b.top} width={layout.bounds.maxX - layout.bounds.minX} height={b.height} fill={cssVar('plane')} opacity={0.35} rx={font * 0.5} />
                    <text x={layout.bounds.minX + font} y={b.top + font * 1.6} fontSize={font} fontWeight={700} fill={cssVar('muted')} aria-hidden="true">{planeLabel(b.partition)}</text>
                </g>
            ))}
        </>
    );
});

/** Path data per tone bucket, built once per set of groups (not on every render of a selection). */
const pathsOf = (groups: Array<EdgeGroup<readonly [number, number]>>) => groups.map((g) => ({ bucket: g.bucket, tone: g.tone, d: segments(g.pairs) }));

const Edges = memo(function Edges({ edges, nodes, layout, selected }: { edges: readonly KEdge[]; nodes: readonly KNode[]; layout: Layout2D; selected: string | null }) {
    // At most MAX_DRAWN_EDGES are drawn (the camera says so). The BASE layer does not depend on the selection, so a click
    // rebuilds only the incident overlay, which holds the selected node's links complete.
    const ranked = useRankedEdges(edges, nodes);
    const drawn = useMemo(() => (ranked ? pickEdges(ranked, null) : []), [ranked]);
    const at = useCallback((ref: string) => layout.positions.get(ref), [layout]);
    const groups = useDeferredWhen(() => pathsOf(groupEdges(drawn, at)), [drawn, at], drawn.length > DEFER_EDGES_ABOVE, []) ?? [];
    const incident = useMemo(() => (ranked ? pathsOf(groupEdges(incidentOf(ranked, selected), at)) : []), [ranked, at, selected]);
    return (
        <g fill="none" aria-hidden="true">
            {groups.map((g) => {
                const loud = g.bucket === 'violation' || g.bucket === 'cycle';
                return <path key={g.bucket} data-edge={g.bucket} d={g.d} stroke={cssVar(g.tone)} vectorEffect="non-scaling-stroke" strokeWidth={loud ? 1.6 : 1} opacity={selected ? 0.25 : loud ? 0.9 : 0.5} />;
            })}
            {incident.map((g) => (
                <path key={g.bucket} data-incident={g.bucket} d={g.d} stroke={cssVar('accent')} vectorEffect="non-scaling-stroke" strokeWidth={2} />
            ))}
        </g>
    );
});

interface NodeLayerProps {
    ordered: readonly KNode[];
    layout: Layout2D;
    lens: LensDef;
    selected: string | null;
    stops: ReadonlySet<string>;
    perPx: number;
    labels: KnowledgeGraphLabels;
    onActivate(ref: string): void;
    onArrow(e: KeyboardEvent<SVGElement>): void;
}

interface NodeDotProps {
    n: KNode;
    at: readonly [number, number];
    tone: ThemeTone;
    dim: boolean;
    r: number;
    tab: boolean;
    pressed: boolean;
    labels: KnowledgeGraphLabels;
    onActivate(ref: string): void;
    onArrow(e: KeyboardEvent<SVGElement>): void;
}

/** ONE node. Memoised on primitives and stable objects, so a click re-renders the two nodes whose state changed, not all of them. */
const NodeDot = memo(function NodeDot({ n, at, tone, dim, r, tab, pressed, labels, onActivate, onArrow }: NodeDotProps) {
    return (
        <g
            data-id={n.ref} role="button" aria-pressed={pressed} style={{ cursor: 'pointer' }}
            tabIndex={tab ? 0 : -1} data-keep={tab ? '1' : undefined}
            aria-label={fillTemplate(labels.nodeAria, { label: n.label, kind: kindLabel(labels, n.kind) })}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(n.ref); } else onArrow(e);
            }}
        >
            <circle cx={at[0]} cy={at[1]} r={r} fill={cssVar(tone)} opacity={dim ? 0.35 : 1} stroke={cssVar('bg')} strokeWidth={0.1} data-dot="true" pointerEvents="none" />
        </g>
    );
});

const NodeLayer = memo(function NodeLayer({ ordered, layout, lens, selected, stops, perPx, labels, onActivate, onArrow }: NodeLayerProps) {
    const styles = useMemo(() => ordered.map((n) => lens.nodeStyle(n)), [ordered, lens]);
    return (
        <g>
            {ordered.map((n, i) => {
                const at = layout.positions.get(n.ref);
                if (!at) return null;
                const style = styles[i]!;
                return (
                    <NodeDot
                        key={n.ref} n={n} at={at} tone={style.tone} dim={style.emphasis === 'dim'} r={Math.max(nodeRadius(n.importance), 3 * perPx)}
                        tab={stops.has(n.ref) || n.ref === selected} pressed={n.ref === selected} labels={labels} onActivate={onActivate} onArrow={onArrow}
                    />
                );
            })}
        </g>
    );
});

const Captions = memo(function Captions({ ordered, layout, named, selected, font }: { ordered: readonly KNode[]; layout: Layout2D; named: ReadonlySet<string>; selected: string | null; font: number }) {
    const shown = useMemo(() => ordered.filter((n) => named.has(n.ref) && layout.positions.has(n.ref)), [ordered, layout, named]);
    return (
        <g aria-hidden="true" pointerEvents="none" fontSize={font} fill={cssVar('text')}>
            {shown.map((n) => {
                const p = layout.positions.get(n.ref);
                if (!p) return null;
                return (
                    <text key={n.ref} x={p[0] + nodeRadius(n.importance) + font * 0.4} y={p[1] + font * 0.35} fontWeight={n.ref === selected ? 700 : 400} stroke={cssVar('bg')} strokeWidth={font * 0.3} paintOrder="stroke">
                        {n.label}
                    </text>
                );
            })}
        </g>
    );
});

export function Graph2D({ rootId, nodes, edges, lens, selected, onSelect, planeLabel, labels, label }: Graph2DProps) {
    const host = useRef<HTMLDivElement>(null);
    const size = useContainerSize(host);
    const layout = useIdleSteps(() => layout2dTask(rootId, nodes, edges), [rootId, nodes, edges], EMPTY_LAYOUT_2D);
    const base = useMemo(() => (layout ? fitView(layout, size.width, size.height) : null), [layout, size.width, size.height]);
    const pan = usePanZoom(base, layout);
    usePanZoomRegistration(pan); // the scene overlay's +, − and Fit drive this view
    const roving = useRoving();
    const { perPx, font } = useSvgScale(pan.view, size);
    const ordered = useMemo(() => [...nodes].sort(byImportance), [nodes]);
    const stops = useMemo(() => new Set<string>(ordered.slice(0, TAB_STOPS).map((n) => n.ref)), [ordered]);
    // ref → the refs it links to, built once per edge set: a click reads one entry instead of scanning every edge.
    const neighbours = useMemo(() => {
        const out = new Map<string, string[]>();
        const add = (a: string, b: string): void => { const l = out.get(a); if (l) l.push(b); else out.set(a, [b]); };
        for (const e of edges) { add(e.from, e.to); add(e.to, e.from); }
        return out;
    }, [edges]);
    const named = useMemo(() => {
        const refs = new Set<string>(ordered.slice(0, LABELLED_NODES).map((n) => n.ref));
        if (selected) {
            refs.add(selected);
            for (const other of neighbours.get(selected) ?? []) refs.add(other);
        }
        return refs;
    }, [ordered, neighbours, selected]);

    const at = selected ? layout?.positions.get(selected) : undefined;
    const { reveal, wasDrag } = pan;
    useEffect(() => { if (at) reveal(at[0], at[1]); }, [at]); // eslint-disable-line react-hooks/exhaustive-deps
    const onSelectRef = useRef(onSelect);
    onSelectRef.current = onSelect;
    const activate = useCallback((ref: string) => { if (!wasDrag()) onSelectRef.current(ref); }, [wasDrag]);
    const spots = useMemo(
        () => (layout ? ordered.flatMap((n) => { const p = layout.positions.get(n.ref); return p ? [{ id: n.ref, x: p[0], y: p[1], importance: n.importance }] : []; }) : []),
        [ordered, layout],
    );
    // ONE pointer handler for every node: the nearest centre wins, so overlapping hit areas never steal a click.
    const onSvgClick = (e: MouseEvent<SVGSVGElement>) => {
        const pt = pan.toPoint(e.clientX, e.clientY);
        const id = pt ? nearestHit(spots, pt.x, pt.y, HIT_PX * pt.unit) : (e.target as Element).closest('[data-id]')?.getAttribute('data-id') ?? null;
        if (id) activate(id);
    };
    const ringAt = roving.ring ? layout?.positions.get(roving.ring) : undefined;

    return (
        <div ref={host} data-testid="kg-graph2d" aria-busy={!layout} style={{ position: 'absolute', inset: 0, color: cssVar('text'), background: cssVar('bg'), touchAction: 'none' }}>
            {!layout && <LayingOut labels={labels} />}
            {layout && pan.viewBox && (
                <>
                    <svg
                        ref={pan.svgRef} role="group" aria-label={label} viewBox={pan.viewBox} preserveAspectRatio="xMidYMid meet"
                        width="100%" height="100%" style={{ display: 'block', cursor: 'grab', userSelect: 'none' }} {...pan.bind}
                        onFocus={roving.onFocus} onBlur={roving.onBlur} onClick={onSvgClick}
                    >
                        <title>{label}</title>
                        <desc>{labels.graphHint}</desc>
                        <Bands layout={layout} font={font} planeLabel={planeLabel} />
                        <Edges edges={edges} nodes={nodes} layout={layout} selected={selected} />
                        <NodeLayer
                            ordered={ordered} layout={layout} lens={lens} selected={selected} stops={stops}
                            perPx={perPx} labels={labels} onActivate={activate} onArrow={roving.onArrow}
                        />
                        {selected && at && (
                            <circle data-selected="true" cx={at[0]} cy={at[1]} r={nodeRadius(1) + 4 * perPx} fill="none" stroke={cssVar('accent')} strokeWidth={3 * perPx} pointerEvents="none" />
                        )}
                        {ringAt && <circle data-focus="true" cx={ringAt[0]} cy={ringAt[1]} r={nodeRadius(1) + 8 * perPx} fill="none" stroke={cssVar('accent')} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeDasharray="4 3" pointerEvents="none" />}
                        <Captions ordered={ordered} layout={layout} named={named} selected={selected} font={font} />
                    </svg>
                </>
            )}
        </div>
    );
}

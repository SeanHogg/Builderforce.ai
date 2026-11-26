/**
 * The 2D graph — the default view. Partitions are horizontal bands (top-down by flow), a
 * node is a circle sized by importance and toned by the active lens, edges are ONE path per
 * tone. Wheel/pinch zoom, drag pans; a node is a button with a thumb-sized hit target. Tab
 * stops are the most important nodes (plus the selection), arrow keys walk the rest in
 * importance order. Labels are drawn only for the selection, its neighbours and the top few
 * nodes. Each layer is memoised on props that do not change while panning, so a drag moves
 * the viewBox and re-renders nothing.
 */

import { memo, useCallback, useEffect, useMemo, useRef, type MouseEvent } from 'react';
import type { KEdge, KNode } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeGraphLabels } from '../labels';
import type { LensDef } from '../lenses';
import { useContainerSize } from '../environment';
import { byImportance } from '../graphModel';
import { useComputed } from '../compute/useComputed';
import { DEFER_EDGES_ABOVE, incidentOf } from '../scene/edgeBudget';
import { useRankedEdges } from '../scene/useRankedEdges';
import { LayingOut } from '../surface/LayingOut';
import { usePanZoom } from '../usePanZoom';
import { useRoving } from '../useRoving';
import { FONT_PX, HIT_PX, useSvgScale } from '../useSvgScale';
import { nearestHit } from '../hitTest';
import { usePanZoomRegistration } from '../surface/zoom';
import { cssVar } from '../scene/themeColors';
import { groupEdges } from '../scene/buffers';
import { pathsOf } from './edgePaths';
import { bandCaption, placeCaptions, type CaptionCandidate } from './captionPlacement';
import { NodeCanvas } from './NodeCanvas';
import { EMPTY_LAYOUT_2D, fitView, nodeRadius, type Layout2D } from './layout2d';

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

const Bands = memo(function Bands({ layout, font, planeLabel }: { layout: Layout2D; font: number; planeLabel(p: string): string }) {
    return (
        <>
            {layout.bands.map((b) => {
                const text = planeLabel(b.partition);
                const at = bandCaption(b, layout.bounds, font, text);
                return (
                    <g key={b.partition} data-band={b.partition}>
                        <rect x={layout.bounds.minX} y={b.top} width={layout.bounds.maxX - layout.bounds.minX} height={b.height} fill={cssVar('plane')} opacity={0.35} rx={font * 0.5} />
                        <text x={at.x} y={at.y} fontSize={font} fontWeight={700} fill={cssVar('muted')} aria-hidden="true">{text}</text>
                    </g>
                );
            })}
        </>
    );
});

const Edges = memo(function Edges({ edges, nodes, layout, selected }: { edges: readonly KEdge[]; nodes: readonly KNode[]; layout: Layout2D; selected: string | null }) {
    // At most MAX_DRAWN_EDGES are drawn (the camera says so). The BASE layer does not depend on the selection, so a click
    // rebuilds only the incident overlay, which holds the selected node's links complete. The base layer's picking and path
    // data are built in the compute worker (which holds the ranking), the small incident overlay here.
    const ranked = useRankedEdges(edges, nodes);
    const at = useCallback((ref: string) => layout.positions.get(ref), [layout]);
    const groups = useComputed('edgePaths', { nodes, edges, layout }, [nodes, edges, layout], [], { enabled: ranked !== null, inline: edges.length <= DEFER_EDGES_ABOVE }).value ?? [];
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

/** The drawn mark's radius: the canvas never paints a node smaller than 3 CSS pixels (font is 11 of them). */
const markRadius = (importance: number, font: number): number => Math.max(nodeRadius(importance), (font * 3) / FONT_PX);

const Captions = memo(function Captions({ ordered, layout, named, selected, font, planeLabel }: { ordered: readonly KNode[]; layout: Layout2D; named: ReadonlySet<string>; selected: string | null; font: number; planeLabel(p: string): string }) {
    // Collision-avoided: the selection first, then importance order; a caption with no free side is dropped.
    const placed = useMemo(() => {
        const candidates: CaptionCandidate[] = [];
        const push = (n: KNode): void => {
            const p = layout.positions.get(n.ref);
            if (p) candidates.push({ ref: n.ref, x: p[0], y: p[1], r: markRadius(n.importance, font), text: n.label, always: n.ref === selected });
        };
        const sel = selected ? ordered.find((n) => n.ref === selected) : undefined;
        if (sel) push(sel);
        for (const n of ordered) if (n !== sel && named.has(n.ref)) push(n);
        const bandBoxes = layout.bands.map((b) => bandCaption(b, layout.bounds, font, planeLabel(b.partition)).box);
        const labelOf = new Map(candidates.map((c) => [c.ref, c.text] as const));
        return placeCaptions(candidates, font, bandBoxes).map((c) => ({ ...c, text: labelOf.get(c.ref)! }));
    }, [ordered, layout, named, selected, font, planeLabel]);
    return (
        <g aria-hidden="true" pointerEvents="none" fontSize={font} fill={cssVar('text')}>
            {placed.map((c) => (
                <text key={c.ref} data-caption={c.ref} x={c.x} y={c.y} textAnchor={c.anchor} fontWeight={c.ref === selected ? 700 : 400} stroke={cssVar('bg')} strokeWidth={font * 0.3} paintOrder="stroke">
                    {c.text}
                </text>
            ))}
        </g>
    );
});

export function Graph2D({ rootId, nodes, edges, lens, selected, onSelect, planeLabel, labels, label }: Graph2DProps) {
    const host = useRef<HTMLDivElement>(null);
    const size = useContainerSize(host);
    const layout = useComputed('layout2d', { rootId, nodes, edges }, [rootId, nodes, edges], null, { failed: EMPTY_LAYOUT_2D }).value;
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
                        <NodeCanvas
                            ordered={ordered} layout={layout} lens={lens} selected={selected} stops={stops}
                            perPx={perPx} view={pan.view} size={size} hostEl={host.current} labels={labels}
                            onActivate={activate} onArrow={roving.onArrow}
                        />
                        {selected && at && (
                            <circle data-selected="true" cx={at[0]} cy={at[1]} r={nodeRadius(1) + 4 * perPx} fill="none" stroke={cssVar('accent')} strokeWidth={3 * perPx} pointerEvents="none" />
                        )}
                        {ringAt && <circle data-focus="true" cx={ringAt[0]} cy={ringAt[1]} r={nodeRadius(1) + 8 * perPx} fill="none" stroke={cssVar('accent')} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeDasharray="4 3" pointerEvents="none" />}
                        <Captions ordered={ordered} layout={layout} named={named} selected={selected} font={font} planeLabel={planeLabel} />
                    </svg>
                </>
            )}
        </div>
    );
}

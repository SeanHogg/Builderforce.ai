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
import { useIdleValue } from '../useIdleValue';
import { usePanZoom } from '../usePanZoom';
import { useRoving } from '../useRoving';
import { HIT_PX, useSvgScale } from '../useSvgScale';
import { nearestHit } from '../hitTest';
import { usePanZoomRegistration } from '../surface/zoom';
import { kindLabel } from '../names';
import { groupEdges } from '../scene/buffers';
import { cssVar } from '../scene/themeColors';
import { fitView, layout2d, nodeRadius, type Layout2D } from './layout2d';

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

const Edges = memo(function Edges({ edges, layout, selected }: { edges: readonly KEdge[]; layout: Layout2D; selected: string | null }) {
    const groups = useMemo(() => groupEdges(edges, (ref) => layout.positions.get(ref)), [edges, layout]);
    const incident = useMemo(
        () => (selected ? groupEdges(edges.filter((e) => e.from === selected || e.to === selected), (ref) => layout.positions.get(ref)) : []),
        [edges, layout, selected],
    );
    return (
        <g fill="none" aria-hidden="true">
            {groups.map((g) => {
                const loud = g.bucket === 'violation' || g.bucket === 'cycle';
                return <path key={g.bucket} data-edge={g.bucket} d={segments(g.pairs)} stroke={cssVar(g.tone)} vectorEffect="non-scaling-stroke" strokeWidth={loud ? 1.6 : 1} opacity={selected ? 0.25 : loud ? 0.9 : 0.5} />;
            })}
            {incident.map((g) => (
                <path key={g.bucket} data-incident={g.bucket} d={segments(g.pairs)} stroke={cssVar('accent')} vectorEffect="non-scaling-stroke" strokeWidth={2} />
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

const NodeLayer = memo(function NodeLayer({ ordered, layout, lens, selected, stops, perPx, labels, onActivate, onArrow }: NodeLayerProps) {
    return (
        <g>
            {ordered.map((n) => {
                const p = layout.positions.get(n.ref);
                if (!p) return null;
                const style = lens.nodeStyle(n);
                const r = Math.max(nodeRadius(n.importance), 3 * perPx);
                return (
                    <g
                        key={n.ref} data-id={n.ref} role="button" aria-pressed={n.ref === selected} style={{ cursor: 'pointer' }}
                        tabIndex={stops.has(n.ref) || n.ref === selected ? 0 : -1} data-keep={stops.has(n.ref) || n.ref === selected ? '1' : undefined}
                        aria-label={fillTemplate(labels.nodeAria, { label: n.label, kind: kindLabel(labels, n.kind) })}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(n.ref); } else onArrow(e);
                        }}
                    >
                        <circle cx={p[0]} cy={p[1]} r={r} fill={cssVar(style.tone)} opacity={style.emphasis === 'dim' ? 0.35 : 1} stroke={cssVar('bg')} strokeWidth={0.1} data-dot="true" pointerEvents="none" />
                    </g>
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
                const p = layout.positions.get(n.ref)!;
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
    const layout = useIdleValue(() => layout2d(rootId, nodes, edges), [rootId, nodes, edges]);
    const base = useMemo(() => (layout ? fitView(layout, size.width, size.height) : null), [layout, size.width, size.height]);
    const pan = usePanZoom(base, layout);
    usePanZoomRegistration(pan); // the scene overlay's +, − and Fit drive this view
    const roving = useRoving();
    const { perPx, font } = useSvgScale(pan.view, size);
    const ordered = useMemo(() => [...nodes].sort(byImportance), [nodes]);
    const stops = useMemo(() => new Set<string>(ordered.slice(0, TAB_STOPS).map((n) => n.ref)), [ordered]);
    const named = useMemo(() => {
        const refs = new Set<string>(ordered.slice(0, LABELLED_NODES).map((n) => n.ref));
        if (selected) {
            refs.add(selected);
            for (const e of edges) { if (e.from === selected) refs.add(e.to); else if (e.to === selected) refs.add(e.from); }
        }
        return refs;
    }, [ordered, edges, selected]);

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
                        <Edges edges={edges} layout={layout} selected={selected} />
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

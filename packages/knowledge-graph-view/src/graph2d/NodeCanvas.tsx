/**
 * The canvas node layer — one `<canvas>` for every node mark (thousands of DOM elements
 * become ONE) plus a small SVG overlay of invisible, focusable `<g>` for the tab stops
 * (canvas pixels can't take focus or keys). The marks are built in importance order,
 * bucketed by SHAPE, culled against the committed viewBox, and painted in batches across
 * requestAnimationFrame frames; any change to the committed view, the container's size,
 * the theme or the node set restarts the pass with a clear. Pan/zoom drags only move the
 * SVG's viewBox, so the canvas redraws when the view COMMITS — never during the gesture.
 */

import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { KNode } from '@seanhogg/builderforce-memory/knowledge';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { kindLabel } from '../names';
import type { LensDef } from '../lenses';
import { byImportance } from '../graphModel';
import { SHAPE_PATHS } from '../shapes';
import { useThemeColors } from '../scene/themeColors';
import type { ViewBox } from '../usePanZoom';
import type { ContainerSize } from '../environment';
import { bucketByShape, canvasMapping, drawMark, markVisible, DRAW_BATCH, type NodeMark } from './drawNodes';
import { nodeRadius, type Layout2D } from './layout2d';

interface NodeCanvasProps {
    ordered: readonly KNode[];
    layout: Layout2D;
    lens: LensDef;
    selected: string | null;
    stops: ReadonlySet<string>;
    perPx: number;
    view: ViewBox | null;
    size: ContainerSize;
    hostEl: HTMLElement | null;
    labels: KnowledgeGraphLabels;
    onActivate(ref: string): void;
    onArrow(e: KeyboardEvent<SVGElement>): void;
}

/** The accessible name every node's button carries (canvas or overlay). */
export function nodeAriaLabel(labels: KnowledgeGraphLabels, n: KNode): string {
    return fillTemplate(labels.nodeAria, { label: n.label, kind: kindLabel(labels, n.kind) });
}

interface StopItem {
    n: KNode;
    at: readonly [number, number] | undefined;
}

/**
 * The tab stops: the top `stops` nodes (plus the selection) as invisible focusable `<g>`,
 * a transparent `<circle data-dot>` inside a real bounding box so clicks (and jsdom's
 * fireEvent) land on the node. Exactly TAB_STOPS DOM nodes regardless of graph size, in
 * importance order — the roving arrow keys walk their sibling order. Only re-renders when
 * the stop set, the layout or the selection actually changes, not on every committed view.
 */
const TabStops = memo(function TabStops({ items, selected, labels, onActivate, onArrow }: {
    items: readonly StopItem[];
    selected: string | null;
    labels: KnowledgeGraphLabels;
    onActivate(ref: string): void;
    onArrow(e: KeyboardEvent<SVGElement>): void;
}) {
    return (
        <>
            {items.map(({ n, at }) => {
                if (!at) return null;
                const pressed = n.ref === selected;
                return (
                    <g
                        key={n.ref} data-id={n.ref} role="button" aria-pressed={pressed} style={{ cursor: 'pointer' }}
                        tabIndex={-1} data-keep="1"
                        aria-label={nodeAriaLabel(labels, n)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(n.ref); } else onArrow(e);
                        }}
                    >
                        <circle data-dot="true" cx={at[0]} cy={at[1]} r={Math.max(nodeRadius(n.importance), 0.35)} fill="transparent" />
                    </g>
                );
            })}
        </>
    );
});

export const NodeCanvas = memo(function NodeCanvas({ ordered, layout, lens, selected, stops, perPx, view, size, hostEl, labels, onActivate, onArrow }: NodeCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const colors = useThemeColors(hostEl);
    const [ready, setReady] = useState(false);

    /** Marks in importance order, with each mark memoised on its primitives so a selection change doesn't rebuild 15k of them. */
    const marks = useMemo(() => {
        return ordered.flatMap((n): NodeMark[] => {
            const at = layout.positions.get(n.ref);
            if (!at) return [];
            return [{ id: n.ref, x: at[0], y: at[1], r: Math.max(nodeRadius(n.importance), 3 * perPx), ...lens.nodeStyle(n) }];
        });
    }, [ordered, layout, lens, perPx]);

    /** One Path2D per shape kind, reused across frames — the WebGL `Cylinders` bucketing, in 2D. */
    const shapePaths = useMemo(() => {
        const out = {} as Record<keyof typeof SHAPE_PATHS, Path2D>;
        for (const shape of Object.keys(SHAPE_PATHS) as (keyof typeof SHAPE_PATHS)[]) out[shape] = new Path2D(SHAPE_PATHS[shape]);
        return out;
    }, []);

    /** The painted marks, culling off-screen ones once per pass instead of per draw call. */
    const paintSet = useMemo(() => (view ? marks.filter((m) => markVisible(m, view)) : []), [marks, view]);

    // The incremental paint pass: re-fit the backing store, then draw a batch of marks per frame
    // until done, clearing the canvas to a pristine reset on the FIRST batch of a pass (a bare
    // clearRect on a transformed context would leave half-transparent ghosts). Runs when the
    // committed view, size, theme, lens or node set changes — never mid-gesture, since a drag
    // only writes the viewBox attribute until the view commits.
    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx || !view || !size.width || !size.height || !colors) {
            setReady(false);
            return undefined;
        }
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(size.width * dpr);
        canvas.height = Math.round(size.height * dpr);
        const mapping = canvasMapping(view, size.width, size.height);
        if (!mapping) return undefined;
        const buckets = bucketByShape(paintSet);
        let raf = 0;
        let first = true;
        setReady(false);
        const paint = (): void => {
            // The first batch owns the canvas: reset any previous pass, re-fit the transform, draw its marks.
            if (first) {
                first = false;
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
            ctx.setTransform(dpr * mapping.scale, 0, 0, dpr * mapping.scale, dpr * mapping.ox, dpr * mapping.oy);
            let drawn = 0;
            for (const bucket of buckets) {
                const path = shapePaths[bucket.shape];
                while (bucket.marks.length > 0 && drawn < DRAW_BATCH) {
                    drawMark(ctx, bucket.marks.shift()!, path, colors, colors.bg);
                    drawn++;
                }
            }
            const done = buckets.every((b) => b.marks.length === 0);
            if (done) setReady(true);
            else raf = requestAnimationFrame(paint);
        };
        raf = requestAnimationFrame(paint);
        return () => cancelAnimationFrame(raf);
    }, [paintSet, view, size, colors, shapePaths]);

    // The ≤25 tab stops (top-importance plus the selection): invisible focusable `<g>` so the
    // roving keyboard walk, Enter/Space activation and the button accessible names survive the
    // move off per-node DOM. Stable per node (memoised on primitives + selected) so a selection
    // change re-renders only the two overlay stops whose pressed state moved.
    const stopsItems = useMemo(
        () => ordered.filter((n) => stops.has(n.ref) || n.ref === selected).map((n): StopItem => ({ n, at: layout.positions.get(n.ref) })),
        [ordered, stops, layout, selected],
    );

    const onOverlayClick = (e: MouseEvent<SVGGElement>) => {
        if (e.target === e.currentTarget) return;
        const g = (e.target as Element).closest('[data-id]');
        const id = g?.getAttribute('data-id');
        if (id) onActivate(id);
    };

    if (!view) return null;
    return (
        <g data-layer="canvas-nodes">
            <foreignObject x={view.x} y={view.y} width={view.w} height={view.h} style={{ overflow: 'visible' }} aria-hidden="true">
                <canvas
                    ref={canvasRef}
                    data-canvas="nodes"
                    data-ready={ready ? 'true' : undefined}
                    style={{ width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}
                />
            </foreignObject>
            <g onClick={onOverlayClick}>
                <TabStops items={stopsItems} selected={selected} labels={labels} onActivate={onActivate} onArrow={onArrow} />
            </g>
        </g>
    );
});

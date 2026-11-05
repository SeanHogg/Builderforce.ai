/**
 * The mind map: the folder tree as a radial map (root → folders → the top files). A branch is
 * toned by the worst finding beneath it; clicking a folder focuses its files, clicking a file
 * selects it. Same pan/zoom, thumb-sized hit targets and roving focus as the 2D graph: the
 * root and its folders are Tab stops, arrow keys walk the rest.
 */

import { memo, useCallback, useMemo, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import type { Finding, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { useContainerSize } from '../environment';
import { fitView } from '../graph2d/layout2d';
import { useIdleValue } from '../useIdleValue';
import { usePanZoom } from '../usePanZoom';
import { useRoving } from '../useRoving';
import { HIT_PX, useSvgScale } from '../useSvgScale';
import { nearestHit } from '../hitTest';
import { ZoomControls } from '../ZoomControls';
import { kindLabel } from '../names';
import { cssVar } from '../scene/themeColors';
import { mindMap, type MindMap as MindMapModel, type PlacedBranch } from './mindMapModel';

const MAX_LABEL = 24;
const RADIUS = { root: 1.8, folder: 1.2, file: 0.7, more: 0.7 } as const;
const clip = (s: string): string => (s.length > MAX_LABEL ? `${s.slice(0, MAX_LABEL - 1)}…` : s);

export interface MindMapProps {
    nodes: readonly KNode[];
    findings: readonly Finding[];
    /** The reviewed folder's name: the root's caption. */
    rootTitle: string;
    selected: string | null;
    onSelect(ref: string): void;
    onShow(refs: string[]): void;
    labels: KnowledgeGraphLabels;
    label: string;
}

interface LayerProps {
    map: MindMapModel;
    rootTitle: string;
    kinds: ReadonlyMap<string, string>;
    selected: string | null;
    perPx: number;
    font: number;
    labels: KnowledgeGraphLabels;
    onActivate(b: PlacedBranch): void;
    onArrow(e: KeyboardEvent<SVGElement>): void;
}

function wording(b: PlacedBranch, p: Pick<LayerProps, 'rootTitle' | 'kinds' | 'labels'>): { text: string; aria: string } {
    const { labels } = p;
    if (b.kind === 'root') return { text: clip(p.rootTitle), aria: fillTemplate(labels.mapBranch, { name: p.rootTitle, count: b.count }) };
    if (b.kind === 'more') { const t = fillTemplate(labels.mapMore, { count: b.count }); return { text: t, aria: t }; }
    if (b.kind === 'file') return { text: clip(b.name), aria: fillTemplate(labels.nodeAria, { label: b.name, kind: kindLabel(labels, p.kinds.get(b.ref ?? '') ?? 'file') }) };
    return { text: `${clip(b.name)} (${b.count})`, aria: fillTemplate(labels.mapBranch, { name: b.name, count: b.count }) };
}

const Branches = memo(function Branches(p: LayerProps) {
    const { map, selected, perPx, font, onActivate, onArrow } = p;
    return (
        <g>
            {map.branches.map((b) => {
                const w = wording(b, p);
                const left = Math.cos(b.angle) < -0.01;
                const root = b.kind === 'root';
                const r = Math.max(RADIUS[b.kind], 3 * perPx);
                const active = b.ref !== undefined && b.ref === selected;
                return (
                    <g
                        key={b.id} data-id={b.id} data-branch={b.kind} data-severity={b.severity} role="button" aria-label={w.aria}
                        aria-pressed={b.kind === 'file' ? active : undefined} tabIndex={b.depth <= 1 || active ? 0 : -1} data-keep={b.depth <= 1 || active ? '1' : undefined}
                        style={{ cursor: 'pointer' }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(b); } else onArrow(e); }}
                    >
                        <circle
                            cx={b.x} cy={b.y} r={r} pointerEvents="none" fill={b.kind === 'more' ? cssVar('bg') : cssVar(b.tone)}
                            stroke={cssVar(b.tone)} strokeWidth={1.5} vectorEffect="non-scaling-stroke"
                        />
                        {active && <circle data-selected="true" cx={b.x} cy={b.y} r={r + 4 * perPx} fill="none" stroke={cssVar('accent')} strokeWidth={3 * perPx} pointerEvents="none" />}
                        <text
                            aria-hidden="true" pointerEvents="none" fontSize={font} fill={cssVar('text')} fontWeight={root || b.kind === 'folder' || active ? 700 : 400}
                            x={root ? b.x : b.x + (left ? -1 : 1) * (r + font * 0.5)} y={root ? b.y - r - font * 0.6 : b.y + font * 0.35}
                            textAnchor={root ? 'middle' : left ? 'end' : 'start'} stroke={cssVar('bg')} strokeWidth={font * 0.3} paintOrder="stroke"
                        >
                            {w.text}
                        </text>
                    </g>
                );
            })}
        </g>
    );
});

export function MindMap({ nodes, findings, rootTitle, selected, onSelect, onShow, labels, label }: MindMapProps) {
    const host = useRef<HTMLDivElement>(null);
    const size = useContainerSize(host);
    const map = useIdleValue(() => mindMap(nodes, findings), [nodes, findings]);
    const base = useMemo(() => (map ? fitView(map, size.width, size.height) : null), [map, size.width, size.height]);
    const pan = usePanZoom(base, map);
    const roving = useRoving();
    const { perPx, font } = useSvgScale(pan.view, size);
    const byId = useMemo(() => new Map((map?.branches ?? []).map((b) => [b.id, b] as const)), [map]);
    const kinds = useMemo(() => new Map(nodes.map((n) => [n.ref as string, n.kind] as const)), [nodes]);
    const links = useMemo(() => (map?.branches ?? []).flatMap((b) => {
        const p = b.parent !== undefined ? byId.get(b.parent) : undefined;
        return p ? [`M${p.x} ${p.y}L${b.x} ${b.y}`] : [];
    }).join(''), [map, byId]);

    const { wasDrag } = pan;
    const handlers = useRef({ onSelect, onShow });
    handlers.current = { onSelect, onShow };
    const activate = useCallback((b: PlacedBranch) => {
        if (wasDrag()) return;
        if (b.kind === 'file' && b.ref) handlers.current.onSelect(b.ref); else handlers.current.onShow(b.refs);
    }, [wasDrag]);
    const spots = useMemo(() => (map?.branches ?? []).map((b) => ({ id: b.id, x: b.x, y: b.y, importance: b.count })), [map]);
    // ONE pointer handler for every branch: the nearest centre wins, so overlapping hit areas never steal a click.
    const onSvgClick = (e: MouseEvent<SVGSVGElement>) => {
        const pt = pan.toPoint(e.clientX, e.clientY);
        const id = pt ? nearestHit(spots, pt.x, pt.y, HIT_PX * pt.unit) : (e.target as Element).closest('[data-id]')?.getAttribute('data-id') ?? null;
        const b = id !== null ? byId.get(id) : undefined;
        if (b) activate(b);
    };
    const ringAt = roving.ring ? byId.get(roving.ring) : undefined;

    return (
        <div ref={host} data-testid="kg-map" aria-busy={!map} style={{ position: 'absolute', inset: 0, color: cssVar('text'), background: cssVar('bg'), touchAction: 'none' }}>
            {map && pan.viewBox && (
                <>
                    <svg
                        ref={pan.svgRef} role="group" aria-label={label} viewBox={pan.viewBox} preserveAspectRatio="xMidYMid meet"
                        width="100%" height="100%" style={{ display: 'block', cursor: 'grab', userSelect: 'none' }} {...pan.bind}
                        onFocus={roving.onFocus} onBlur={roving.onBlur} onClick={onSvgClick}
                    >
                        <title>{label}</title>
                        <desc>{labels.graphHint}</desc>
                        <path d={links} fill="none" stroke={cssVar('edge')} vectorEffect="non-scaling-stroke" strokeWidth={1} opacity={0.6} aria-hidden="true" />
                        <Branches
                            map={map} rootTitle={rootTitle} kinds={kinds} selected={selected} perPx={perPx} font={font}
                            labels={labels} onActivate={activate} onArrow={roving.onArrow}
                        />
                        {ringAt && <circle data-focus="true" cx={ringAt.x} cy={ringAt.y} r={RADIUS[ringAt.kind] + 8 * perPx} fill="none" stroke={cssVar('accent')} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeDasharray="4 3" pointerEvents="none" />}
                    </svg>
                    <ZoomControls pan={pan} labels={labels} />
                </>
            )}
        </div>
    );
}

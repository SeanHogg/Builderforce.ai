/**
 * The mind map: the folder tree as a radial map (root → folders → the top files). A branch is
 * toned by the worst finding beneath it; clicking a folder focuses its files, clicking a file
 * selects it. Same pan/zoom, thumb-sized hit targets and roving focus as the 2D graph: the
 * root and its folders are Tab stops, arrow keys walk the rest.
 */

import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { LayingOut } from '../surface/LayingOut';
import type { Finding, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { useContainerSize } from '../environment';
import { fitView } from '../graph2d/layout2d';
import { useIdleValue } from '../useIdleValue';
import { usePanZoom } from '../usePanZoom';
import { useRoving } from '../useRoving';
import { HIT_PX, useSvgScale } from '../useSvgScale';
import { nearestHit } from '../hitTest';
import { usePanZoomRegistration } from '../surface/zoom';
import { cssVar } from '../scene/themeColors';
import { TYPE } from '../surface/ui/type';
import { Branches, RADIUS } from './MindBranches';
import { EMPTY_MIND_MAP, focusFolder, mindMap, type PlacedBranch } from './mindMapModel';
import { outTarget } from './mindOut';

export interface MindMapProps {
    nodes: readonly KNode[];
    findings: readonly Finding[];
    /** The reviewed folder's name: the root's caption. */
    rootTitle: string;
    selected: string | null;
    /** The refs the view is focused on: the folder they share is the one the map expands. */
    focus?: readonly string[] | undefined;
    onSelect(ref: string): void;
    onShow(refs: string[]): void;
    labels: KnowledgeGraphLabels;
    label: string;
}

const sameRefs = (a: readonly string[], b: readonly string[]): boolean => a === b || (a.length === b.length && a.every((r, i) => r === b[i]));

export function MindMap({ nodes, findings, rootTitle, selected, focus, onSelect, onShow, labels, label }: MindMapProps) {
    const host = useRef<HTMLDivElement>(null);
    const size = useContainerSize(host);
    // The expanded folder is the one the user chose (a click, or Out), carried with the refs it focused; when the focus came
    // from elsewhere (a search, the host) it is the folder those refs share. The refs alone cannot name it: a parent whose only
    // child is the folder we left holds the same files.
    const [picked, setPicked] = useState<{ folder: string | null; refs: readonly string[] } | null>(null);
    const [paged, setPaged] = useState<{ folder: string | null; parent: string; start: number } | null>(null);
    const shared = useMemo(() => (focus && focus.length ? focusFolder(focus) : null), [focus]);
    const folder = picked && sameRefs(picked.refs, focus ?? []) ? picked.folder : shared;
    const [filesPaged, setFilesPaged] = useState<{ folder: string | null; start: number } | null>(null);
    const paging = useMemo(() => (paged && paged.folder === folder ? { parent: paged.parent, start: paged.start } : null), [paged, folder]);
    const filesPage = useMemo(() => (filesPaged && folder !== null && filesPaged.folder === folder ? { folder, start: filesPaged.start } : null), [filesPaged, folder]);
    const map = useIdleValue(() => mindMap(nodes, findings, { focus: folder, window: paging, files: filesPage }), [nodes, findings, folder, paging, filesPage], EMPTY_MIND_MAP);
    const [hover, setHover] = useState<string | null>(null);
    // On touch the first tap on a branch shows its label and only the second one acts: a finger cannot hover.
    const [tapped, setTapped] = useState<string | null>(null);
    const pointerKind = useRef<string>('mouse');
    const base = useMemo(() => (map ? fitView(map, size.width, size.height) : null), [map, size.width, size.height]);
    const pan = usePanZoom(base, map);
    usePanZoomRegistration(pan); // the scene overlay's +, − and Fit drive this view
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
    /** Focus `refs` and expand `to` (null = the top level): ONE way to move the map, so Out and a click agree. */
    const expand = useCallback((to: string | null, refs: string[]) => {
        setPicked({ folder: to, refs });
        setPaged(null);
        setFilesPaged(null);
        setTapped(null);
        handlers.current.onShow(refs);
    }, []);
    const activate = useCallback((b: PlacedBranch) => {
        if (wasDrag()) return;
        if (pointerKind.current === 'touch' && tapped !== b.id) { setTapped(b.id); return; }
        setTapped(null);
        if (b.kind === 'file' && b.ref) handlers.current.onSelect(b.ref);
        else if (b.page?.of === 'files') setFilesPaged({ folder, start: b.page.next }); // "+N more": the next page of this folder's files
        else if (b.page) setPaged({ folder, parent: b.page.parent, start: b.page.next }); // "+N folders": the next page of that parent's folders
        else expand(b.kind === 'root' ? '' : b.id, b.refs);
    }, [wasDrag, folder, expand, tapped]);
    const spots = useMemo(() => (map?.branches ?? []).map((b) => ({ id: b.id, x: b.x, y: b.y, importance: b.count })), [map]);
    // ONE pointer handler for every branch: the nearest centre wins, so overlapping hit areas never steal a click.
    const onSvgClick = (e: MouseEvent<SVGSVGElement>) => {
        const pt = pan.toPoint(e.clientX, e.clientY);
        const id = pt ? nearestHit(spots, pt.x, pt.y, HIT_PX * pt.unit) : (e.target as Element).closest('[data-id]')?.getAttribute('data-id') ?? null;
        const b = id !== null ? byId.get(id) : undefined;
        if (b) activate(b);
    };
    const ringAt = roving.ring ? byId.get(roving.ring) : undefined;
    const out = useMemo(() => (folder === null ? null : outTarget(nodes, folder, rootTitle)), [nodes, folder, rootTitle]);

    // Escape and Backspace go Out, from anywhere in the map.
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        pointerKind.current = 'key';
        if (out && (e.key === 'Escape' || e.key === 'Backspace')) { e.preventDefault(); expand(out.folder, out.refs); }
    };

    return (
        <div ref={host} data-testid="kg-map" aria-busy={!map} onKeyDown={onKeyDown} style={{ position: 'absolute', inset: 0, color: cssVar('text'), background: cssVar('bg'), touchAction: 'none' }}>
            {!map && <LayingOut labels={labels} />}
            {map && pan.viewBox && (
                <>
                    {/* Before the SVG, so it is the first thing a keyboard or screen reader reaches. */}
                    {out && (
                        <button
                            type="button" data-testid="kg-map-out" onClick={() => expand(out.folder, out.refs)} title={fillTemplate(labels.surface.overlay.outTo, { name: out.name })}
                            style={{ position: 'absolute', zIndex: 1, insetBlockStart: 8, insetInlineStart: 8, maxWidth: 'calc(100% - 16px)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '4px 10px', borderRadius: 6, border: `1px solid ${cssVar('edge')}`, background: cssVar('panel'), color: cssVar('text'), cursor: 'pointer', ...TYPE.meta }}
                        >
                            {fillTemplate(labels.surface.overlay.outTo, { name: out.name })}
                        </button>
                    )}
                    <svg
                        ref={pan.svgRef} role="group" aria-label={label} viewBox={pan.viewBox} preserveAspectRatio="xMidYMid meet"
                        width="100%" height="100%" style={{ display: 'block', cursor: 'grab', userSelect: 'none' }} {...pan.bind}
                        onPointerDownCapture={(e) => { pointerKind.current = e.pointerType; }}
                        onFocus={roving.onFocus} onBlur={roving.onBlur} onClick={onSvgClick}
                    >
                        <title>{label}</title>
                        <desc>{labels.graphHint}</desc>
                        <path d={links} fill="none" stroke={cssVar('edge')} vectorEffect="non-scaling-stroke" strokeWidth={1} opacity={0.6} aria-hidden="true" />
                        <Branches
                            map={map} rootTitle={rootTitle} kinds={kinds} selected={selected} perPx={perPx} font={font}
                            labels={labels} reveal={hover ?? tapped ?? roving.ring ?? null} onActivate={activate} onArrow={roving.onArrow} onHover={setHover}
                        />
                        {ringAt && <circle data-focus="true" cx={ringAt.x} cy={ringAt.y} r={RADIUS[ringAt.kind] + 8 * perPx} fill="none" stroke={cssVar('accent')} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeDasharray="4 3" pointerEvents="none" />}
                    </svg>
                </>
            )}
        </div>
    );
}

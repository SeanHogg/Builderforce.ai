/**
 * The mind map's branch layer: dots, and a label for each branch that has room for it (see `labelBudget`).
 * A branch without room keeps its name in a `<title>` and its `aria-label`, and shows the label while hovered,
 * focused or selected. Folder labels are bold, file labels normal.
 */

import { memo, type KeyboardEvent } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { counted, isOne } from '../surface/plural';
import { kindLabel, kindShape } from '../names';
import { cssVar } from '../scene/themeColors';
import { labelFitsAt } from './labelBudget';
import { SHAPE_PATHS } from '../shapes';
import type { MapKind, MindMap as MindMapModel, PlacedBranch } from './mindMapModel';

const MAX_LABEL = 24;
export const RADIUS: Record<MapKind, number> = { root: 1.8, folder: 1.2, file: 0.7, more: 0.7 };
const clip = (s: string): string => (s.length > MAX_LABEL ? `${s.slice(0, MAX_LABEL - 1)}…` : s);

export interface LayerProps {
    map: MindMapModel;
    rootTitle: string;
    kinds: ReadonlyMap<string, string>;
    selected: string | null;
    /** The branch whose label is shown regardless of room: the one under the pointer or the keyboard. */
    reveal: string | null;
    perPx: number;
    font: number;
    labels: KnowledgeGraphLabels;
    onActivate(b: PlacedBranch): void;
    onArrow(e: KeyboardEvent<SVGElement>): void;
    onHover(id: string | null): void;
}

function wording(b: PlacedBranch, p: Pick<LayerProps, 'rootTitle' | 'kinds' | 'labels'>): { text: string; title: string; aria: string } {
    const { labels } = p;
    // `title` is the full name (the hover text of a branch whose drawn label is clipped or hidden); `text` is what is drawn.
    if (b.kind === 'root') return { text: clip(p.rootTitle), title: p.rootTitle, aria: counted(labels, 'branchFiles', b.count, { name: p.rootTitle }) };
    if (b.kind === 'more') {
        if (b.folders !== undefined) {
            const m = labels.surface.mind, one = isOne(b.folders);
            const text = fillTemplate(one ? m.moreFoldersOne : m.moreFoldersOther, { count: b.folders });
            return { text, title: text, aria: fillTemplate(one ? m.moreFoldersAriaOne : m.moreFoldersAriaOther, { count: b.folders }) };
        }
        const t = fillTemplate(labels.mapMore, { count: b.count });
        return { text: t, title: t, aria: t };
    }
    if (b.kind === 'file') return { text: clip(b.name), title: b.name, aria: fillTemplate(labels.nodeAria, { label: b.name, kind: kindLabel(labels, p.kinds.get(b.ref ?? '') ?? 'file') }) };
    return { text: `${clip(b.name)} (${b.count})`, title: `${b.name} (${b.count})`, aria: counted(labels, 'branchFiles', b.count, { name: b.name }) };
}

function BranchLabel({ b, text, r, font, bold }: { b: PlacedBranch; text: string; r: number; font: number; bold: boolean }) {
    const left = Math.cos(b.angle) < -0.01;
    const root = b.kind === 'root';
    return (
        <text
            aria-hidden="true" pointerEvents="none" fontSize={font} fill={cssVar('text')} fontWeight={bold ? 700 : 400}
            x={root ? b.x : b.x + (left ? -1 : 1) * (r + font * 0.5)} y={root ? b.y - r - font * 0.6 : b.y + font * 0.35}
            textAnchor={root ? 'middle' : left ? 'end' : 'start'} stroke={cssVar('bg')} strokeWidth={font * 0.3} paintOrder="stroke"
        >
            {text}
        </text>
    );
}

export const Branches = memo(function Branches(p: LayerProps) {
    const { map, selected, reveal, perPx, font, onActivate, onArrow, onHover } = p;
    const onTop = (b: PlacedBranch): boolean => b.id === reveal || (b.ref !== undefined && b.ref === selected);
    return (
        <g>
            {map.branches.map((b) => {
                const w = wording(b, p);
                const root = b.kind === 'root';
                const r = Math.max(RADIUS[b.kind], 3 * perPx);
                const active = b.ref !== undefined && b.ref === selected;
                const labelled = root || active || b.id === reveal || labelFitsAt({ radius: b.radius, span: b.span, angle: b.angle, room: b.room, chars: w.text.length, font });
                return (
                    <g
                        key={b.id} data-id={b.id} data-branch={b.kind} data-severity={b.severity} data-labelled={labelled ? '1' : '0'} role="button" aria-label={w.aria}
                        aria-pressed={b.kind === 'file' ? active : undefined} aria-expanded={b.kind === 'folder' || b.kind === 'root' ? b.children.length > 0 : undefined} tabIndex={b.depth <= 1 || active ? 0 : -1} data-keep={b.depth <= 1 || active ? '1' : undefined}
                        style={{ cursor: 'pointer' }}
                        onPointerEnter={() => onHover(b.id)} onPointerLeave={() => onHover(null)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(b); } else onArrow(e); }}
                    >
                        <title>{w.title}</title>
                        {/* The branch's silhouette: the SHAPE_PATHS mark for its kind, so colour is never the only cue
                            (redundant encoding). The path is unit-radius data centred on the origin, so a translate to
                            the branch plus a uniform scale by its radius draws it exactly where the dot was. */}
                        <path
                            data-shape={b.shape} transform={`translate(${b.x} ${b.y}) scale(${r})`} pointerEvents="none"
                            d={SHAPE_PATHS[b.shape]} fill={b.kind === 'more' ? cssVar('bg') : cssVar(b.tone)}
                            stroke={cssVar(b.tone)} strokeWidth={1.5 / r} vectorEffect="non-scaling-stroke"
                        />
                        {active && <circle data-selected="true" cx={b.x} cy={b.y} r={r + 4 * perPx} fill="none" stroke={cssVar('accent')} strokeWidth={3 * perPx} pointerEvents="none" />}
                        {labelled && !onTop(b) && <BranchLabel b={b} text={w.text} r={r} font={font} bold={root || b.kind === 'folder'} />}
                    </g>
                );
            })}
            {/* The revealed (hovered, focused, tapped) and the selected branch's label is drawn LAST, on top of its neighbours', without moving the branch in the DOM. */}
            <g aria-hidden="true" pointerEvents="none">
                {map.branches.filter(onTop).map((b) => (
                    <BranchLabel key={b.id} b={b} text={wording(b, p).text} r={Math.max(RADIUS[b.kind], 3 * perPx)} font={font} bold />
                ))}
            </g>
        </g>
    );
});

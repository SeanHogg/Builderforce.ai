import { useId, useMemo, type CSSProperties } from 'react';
import type { KnowledgeGraphLabels } from '../../labels';
import { edgeKindLabel } from '../../names';
import { cssVar } from '../../scene/themeColors';
import type { DiagramId } from '../../surface/diagrams/catalog';
import type { Diagram, DiagramNode } from '../../surface/diagrams/model';
import { FONT_MONO, TYPE } from '../../surface/ui/type';

const CARD_WIDTH = 176, CARD_HEIGHT = 132, GAP_X = 64, GAP_Y = 70, PAD = 24;
type Point = { x: number; y: number };
const roundKinds = new Set(['useCase', 'state', 'activity', 'process', 'place', 'event', 'actor']);
const diamondKinds = new Set(['decision', 'gateway', 'relationship']);

interface Props { id: DiagramId; model: Diagram; flat: boolean; labels: KnowledgeGraphLabels; onOpen(ref: string): void }

function diagramLayout(model: Diagram, timing: boolean, strategy: boolean) {
    const columns = Math.max(1, Math.min(5, Math.ceil(Math.sqrt(model.nodes.length))));
    const timed = timing ? model.nodes.filter((node) => node.x !== undefined) : [];
    const start = timed.length ? Math.min(...timed.map((node) => node.x!)) : 0;
    const span = timed.length ? Math.max(1, Math.max(...timed.map((node) => node.x!)) - start) : 1;
    const points = new Map(model.nodes.map((node, i) => [node.id, {
        x: strategy && node.x !== undefined ? PAD + Math.min(1, Math.max(0, node.x)) * 660
            : timing && node.x !== undefined ? PAD + (node.x - start) / span * 660
            : node.x !== undefined ? Math.max(PAD, Math.min(2400, node.x)) : PAD + i % columns * (CARD_WIDTH + GAP_X),
        y: strategy && node.y !== undefined ? PAD + (1 - Math.min(1, Math.max(0, node.y))) * 480
            : node.y !== undefined ? Math.max(PAD, Math.min(2400, node.y)) : PAD + Math.floor(i / columns) * (CARD_HEIGHT + GAP_Y),
    }]));
    const width = Math.max(CARD_WIDTH + 2 * PAD, ...[...points.values()].map((p) => p.x + CARD_WIDTH + PAD));
    const height = Math.max(CARD_HEIGHT + 2 * PAD, ...[...points.values()].map((p) => p.y + CARD_HEIGHT + PAD));
    return { points, width, height };
}

function end(from: Point, to: Point) {
    const dx = to.x - from.x, dy = to.y - from.y;
    const scale = Math.max(Math.abs(dx) / (CARD_WIDTH / 2), Math.abs(dy) / (CARD_HEIGHT / 2), 1);
    return { x: from.x + CARD_WIDTH / 2 + dx / scale, y: from.y + CARD_HEIGHT / 2 + dy / scale };
}

const linkButton: CSSProperties = { border: 0, background: 'none', padding: 0, color: 'inherit', font: 'inherit', textAlign: 'start', cursor: 'pointer', overflowWrap: 'anywhere' };

function DiagramBox({ node, point, flat, onOpen }: { node: DiagramNode; point: Point; flat: boolean; onOpen(ref: string): void }) {
    const title = node.ref
        ? <button type="button" style={linkButton} onClick={() => onOpen(node.ref!)}>{node.label}</button>
        : <span>{node.label}</span>;
    return <article data-diagram-node={node.kind} style={{
        position: 'absolute', left: point.x, top: point.y, width: CARD_WIDTH, height: CARD_HEIGHT, zIndex: 1,
        border: `1px solid ${cssVar('border')}`, boxSizing: 'border-box',
        borderRadius: roundKinds.has(node.kind) ? (node.members?.length ? 12 : '50%') : 4,
        transform: diamondKinds.has(node.kind) ? 'scale(.92)' : undefined,
        clipPath: diamondKinds.has(node.kind) ? 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)' : undefined,
        background: cssVar(diamondKinds.has(node.kind) ? 'accentSoft' : 'panel'), color: cssVar('text'), overflow: 'hidden', display: 'flex', flexDirection: 'column',
        boxShadow: flat ? undefined : `0 5px 0 ${cssVar('plane')}, 4px 10px 16px color-mix(in srgb, ${cssVar('text')} 25%, transparent)`,
    }}>
        <header style={{ ...TYPE.meta, fontWeight: 700, padding: '6px 9px', margin: node.members?.length ? 0 : 'auto', textAlign: 'center', overflowWrap: 'anywhere' }}>
            {node.kind === 'interface' || node.kind === 'component' || node.kind === 'stereotype' ? <small style={{ display: 'block', color: cssVar('muted') }}>«{node.kind}»</small> : null}
            {title}
        </header>
        {!!node.members?.length && <ul style={{
            listStyle: 'none', overflow: 'auto', minHeight: 0, margin: 0, padding: '4px 9px',
            borderTop: `1px solid ${cssVar('border')}`, fontFamily: FONT_MONO, fontSize: 11,
        }}>
            {node.members.map((member, i) => <li key={member.ref ?? i} style={{ paddingBlock: 2, overflowWrap: 'anywhere' }}>
                {member.ref ? <button type="button" onClick={() => onOpen(member.ref!)} style={linkButton}>{member.text}</button> : member.text}
            </li>)}
        </ul>}
    </article>;
}

function Matrix({ model, labels }: Pick<Props, 'model' | 'labels'>) {
    const edge = new Map(model.edges.map((item) => [JSON.stringify([item.from, item.to]), item.count ?? 1]));
    return <table aria-label={labels.surface.code.diagramUml} style={{ borderCollapse: 'collapse', fontSize: 11 }}>
        <thead><tr><td />{model.nodes.map((item) => <th scope="col" key={item.id} style={{ padding: 5 }}>{item.label}</th>)}</tr></thead>
        <tbody>{model.nodes.map((from) => <tr key={from.id}>
            <th scope="row" style={{ textAlign: 'start', padding: 5 }}>{from.label}</th>
            {model.nodes.map((to) => {
                const count = edge.get(JSON.stringify([from.id, to.id]));
                return <td key={to.id} style={{ padding: 5, textAlign: 'center', border: `1px solid ${cssVar('border')}`, background: count ? cssVar('accentSoft') : undefined }}>{count ?? ''}</td>;
            })}
        </tr>)}</tbody>
    </table>;
}

export function DiagramView({ id, model, flat, labels, onOpen }: Props) {
    const uid = useId();
    const timing = id === 'timingDiagram';
    const strategy = id === 'wardley';
    const placed = useMemo(() => diagramLayout(model, timing, strategy), [model, timing, strategy]);
    if (id === 'dsm') return <Matrix model={model} labels={labels} />;
    const { points, width, height } = placed;
    const stroke = cssVar('muted');
    const positioned = timing ? model.nodes.filter((node) => node.x !== undefined) : [];
    return <div data-notation={id} data-depth={flat ? 'flat' : '3d'}
        style={{ width, height, transform: flat ? undefined : 'rotateX(16deg) rotateZ(-3deg)', transformOrigin: 'top left' }}>
        <svg aria-label={labels.surface.code.diagramUml} role="img" width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
            <defs>
                <marker id={`${uid}-arrow`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto"><path d="M1,1 L9,5 L1,9" fill="none" stroke={stroke} /></marker>
                <marker id={`${uid}-triangle`} viewBox="0 0 12 12" refX="11" refY="6" markerWidth="11" markerHeight="11" orient="auto"><path d="M1,1 L11,6 L1,11 Z" fill={cssVar('bg')} stroke={stroke} /></marker>
                <marker id={`${uid}-composition`} viewBox="0 0 12 12" refX="1" refY="6" markerWidth="11" markerHeight="11" orient="auto"><path d="M1,6 L6,1 L11,6 L6,11 Z" fill={stroke} /></marker>
                <marker id={`${uid}-many`} viewBox="0 0 12 12" refX="11" refY="6" markerWidth="12" markerHeight="12" orient="auto"><path d="M1,6 L11,1 M1,6 L11,6 M1,6 L11,11" fill="none" stroke={stroke} /></marker>
            </defs>
            {strategy && <path d={`M 12,12 V ${height - 12} H ${width - 12}`} fill="none" stroke={stroke} />}
            {positioned.length > 0 && <g stroke={stroke} fill={stroke}>
                <line x1={PAD} x2={width - PAD} y1={height - 16} y2={height - 16} />
                {[...new Map(positioned.map((node) => [node.x, points.get(node.id)!.x])).entries()].map(([time, x]) => <g key={time}>
                    <line x1={x} y1={height - 20} x2={x} y2={height - 12} /><text x={x + 3} y={height - 2} fontSize="10" stroke="none">{time}</text>
                </g>)}
            </g>}
            {model.edges.map((edge, i) => {
                const a = points.get(edge.from), b = points.get(edge.to);
                if (!a || !b) return null;
                const p = end(a, b);
                const q = end(b, a);
                const kind = edgeKindLabel(labels, edge.kind);
                const ordered = id === 'communicationDiagram';
                const label = `${ordered ? `${i + 1}. ` : ''}${edge.label ?? kind}${edge.count && edge.count > 1 ? ` (${edge.count})` : ''}`;
                const self = edge.from === edge.to;
                const d = self ? `M ${p.x},${p.y} h 30 v 16 h -30` : `M ${p.x},${p.y} L ${q.x},${q.y}`;
                return <g key={i} data-diagram-edge={edge.kind}>
                    <title>{label}</title>
                    <path d={d} fill="none" stroke={stroke}
                        strokeDasharray={edge.kind === 'implements' || edge.kind === 'uses' || edge.kind === 'references' ? '5 4' : undefined}
                        markerEnd={edge.kind === 'composes' ? undefined : `url(#${uid}-${edge.kind === 'extends' || edge.kind === 'implements' ? 'triangle'
                            : id === 'erd' && edge.kind.endsWith('many') ? 'many' : 'arrow'})`}
                        markerStart={edge.kind === 'composes' ? `url(#${uid}-composition)` : undefined} />
                    {model.edges.length <= 36 && <text x={(p.x + q.x) / 2 + (self ? 12 : 0)} y={(p.y + q.y) / 2 - 5}
                        textAnchor="middle" fontSize="10" fill={cssVar('text')} paintOrder="stroke" stroke={cssVar('bg')} strokeWidth="4">{label}</text>}
                </g>;
            })}
        </svg>
        {model.nodes.map((node) => <DiagramBox key={node.id} node={node} point={points.get(node.id)!} flat={flat} onOpen={onOpen} />)}
    </div>;
}

import type { KnowledgeGraphLabels } from '../../labels';
import { edgeKindLabel } from '../../names';
import { cssVar } from '../../scene/themeColors';
import { TYPE_SHAPE } from '../../shapes';
import { ShapeGlyph } from '../../surface/LegendGlyph';
import type { DiagramId } from '../../surface/diagrams/catalog';
import type { Diagram, DiagramNode } from '../../surface/diagrams/model';
import { TYPE } from '../../surface/ui/type';
import { diagramMarkType, diagramName } from './diagramPlacement';

function NodeTitle({ node, onOpen }: { node: DiagramNode; onOpen(ref: string): void }) {
    const name = diagramName(node);
    return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <ShapeGlyph shape={TYPE_SHAPE[diagramMarkType(node.kind)]} />
        {node.ref ? <button type="button" onClick={() => onOpen(node.ref!)}>{name}</button> : name}
    </span>;
}

export function DiagramInspector({ node, labels, onOpen, onClose }: {
    node: DiagramNode; labels: KnowledgeGraphLabels; onOpen(ref: string): void; onClose?: (() => void) | undefined;
}) {
    return <section aria-label={diagramName(node)} style={{ padding: 8 }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <NodeTitle node={node} onOpen={onOpen} />
            {onClose && <button type="button" onClick={onClose}>{labels.close}</button>}
        </header>
        {!!node.members?.length && <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, ...TYPE.monoMeta }}>
            {node.members.map((member, i) => <li key={member.ref ?? i}>
                {member.ref ? <button type="button" onClick={() => onOpen(member.ref!)}>{member.text}</button> : member.text}
            </li>)}
        </ul>}
    </section>;
}

function Matrix({ model, labels }: { model: Diagram; labels: KnowledgeGraphLabels }) {
    const edge = new Map<string, number>();
    for (const item of model.edges) {
        const key = JSON.stringify([item.from, item.to]);
        edge.set(key, (edge.get(key) ?? 0) + (item.count ?? 1));
    }
    return <table aria-label={labels.surface.code.diagramUml} style={{ borderCollapse: 'collapse', fontSize: 11 }}>
        <thead><tr><td />{model.nodes.map((item) => <th scope="col" key={item.id} style={{ padding: 5 }}>{diagramName(item)}</th>)}</tr></thead>
        <tbody>{model.nodes.map((from) => <tr key={from.id}>
            <th scope="row" style={{ textAlign: 'start', padding: 5 }}>{diagramName(from)}</th>
            {model.nodes.map((to) => {
                const count = edge.get(JSON.stringify([from.id, to.id]));
                return <td key={to.id} style={{ padding: 5, textAlign: 'center', border: `1px solid ${cssVar('border')}`, background: count ? cssVar('accentSoft') : undefined }}>{count ?? ''}</td>;
            })}
        </tr>)}</tbody>
    </table>;
}

/** The accessible diagram when the host has no stage renderer. */
export function DiagramView({ id, model, labels, onOpen }: {
    id: DiagramId; model: Diagram; labels: KnowledgeGraphLabels; onOpen(ref: string): void;
}) {
    if (id === 'dsm') return <Matrix model={model} labels={labels} />;
    const names = new Map(model.nodes.map((node) => [node.id, diagramName(node)]));
    return <div data-notation={id} style={{ padding: 8 }}>
        {model.nodes.map((node) => <DiagramInspector key={node.id} node={node} labels={labels} onOpen={onOpen} />)}
        {!!model.edges.length && <ul>
            {model.edges.map(({ from, to, kind, count, label }, i) => <li key={i}>
                {names.get(from)} → {names.get(to)} · {label ?? edgeKindLabel(labels, kind)}{count && count > 1 ? ` (${count})` : ''}
            </li>)}
        </ul>}
    </div>;
}

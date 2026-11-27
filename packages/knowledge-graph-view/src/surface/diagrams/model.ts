import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { callIndex, externalName, isExternal } from '../../compute/tasks/placement/callIndex';
import { deployBindingsOf, deployUnitsOf } from '../../deployFacts';
import { pathOf } from '../../graphModel';
import { cmp } from '../../order';
import type { SymbolRecord } from '../../types';
import { parseRoutes } from '../drawers/apiModel';
import { fileNodesOf, isArchitectureFile, mapEdges, tailOf } from '../outlineGraph';
import { fileRefOf, type Station } from '../stations';
import { appOfNode, modulesOfFiles, systemOfNode } from '../systems';
import type { DiagramId } from './catalog';

export interface DiagramMember { text: string; ref?: string }
export interface DiagramNode {
    id: string; label: string; kind: string;
    ref?: string;
    members?: DiagramMember[];
    /** Positions from authored evidence. Timing uses x as the measured time. */
    x?: number; y?: number;
}
export interface DiagramEdge { from: string; to: string; kind: string; label?: string; count?: number; time?: number }
export interface Diagram { nodes: DiagramNode[]; edges: DiagramEdge[] }
export const EMPTY_DIAGRAM: Diagram = { nodes: [], edges: [] };
const MAX_NODES = 100;
const MAX_EDGES = 600;
const TYPES = new Set(['class', 'interface', 'struct', 'trait', 'enum']);
const ASSOCIATIONS = new Set(['extends', 'implements', 'composes', 'uses']);
const bare = (ref: string) => ref.replace(/@\d+$/, '');

export function checkedDiagram(value: unknown): Diagram | null {
    if (!value || typeof value !== 'object') return null;
    const { nodes, edges } = value as Partial<Diagram>;
    if (!Array.isArray(nodes) || nodes.length > MAX_NODES || !Array.isArray(edges) || edges.length > MAX_EDGES) return null;
    const string = (x: unknown, max = 512): x is string => typeof x === 'string' && x.length > 0 && x.length <= max;
    const coordinate = (x: unknown) => x === undefined || typeof x === 'number' && Number.isFinite(x);
    const ids = new Set<string>();
    for (const node of nodes) {
        // Imported models carry display data only. Source navigation is reserved for refs produced by the reviewed index.
        if (!node || !string(node.id) || ids.has(node.id) || !string(node.label) || !string(node.kind, 40) || node.ref !== undefined
            || !coordinate(node.x) || !coordinate(node.y)) return null;
        if (node.members !== undefined && (!Array.isArray(node.members) || node.members.length > 100 ||
            node.members.some((member) => !member || !string(member.text) || member.ref !== undefined))) return null;
        ids.add(node.id);
    }
    for (const edge of edges) {
        if (!edge || !ids.has(edge.from) || !ids.has(edge.to) || !string(edge.kind, 40)
            || edge.label !== undefined && !string(edge.label) || !coordinate(edge.time)) return null;
    }
    return { nodes, edges };
}

/** OpenAPI and AsyncAPI JSON can be used directly. Only operation and channel metadata is read. */
export function diagramFromFile(id: DiagramId, value: unknown): Diagram | null {
    const checked = checkedDiagram(value);
    if (checked) {
        if (id === 'timingDiagram' && checked.nodes.some((node) => node.x === undefined)) return null;
        if ((id === 'sequenceDiagram' || id === 'communicationDiagram' || id === 'msc') &&
            checked.edges.length && checked.edges.every((edge) => edge.time !== undefined)) {
            return { ...checked, edges: [...checked.edges].sort((a, b) => a.time! - b.time!) };
        }
        return checked;
    }
    if (!value || typeof value !== 'object') return null;
    const contract = value as Record<string, unknown>;
    const matches = id === 'openapi' ? typeof contract.openapi === 'string'
        : id === 'asyncapi' && typeof contract.asyncapi === 'string';
    if (!matches) return null;
    const entries = id === 'openapi' ? contract.paths : contract.channels;
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return null;
    const httpMethods = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);
    const nodes = Object.entries(entries).slice(0, MAX_NODES).flatMap(([name, entry]) => {
        if (!entry || typeof entry !== 'object' || !name || name.length > 512) return [];
        const item = entry as Record<string, unknown>;
        const members = Object.entries(item).flatMap(([method, operation]) => {
            const supported = id === 'openapi' ? httpMethods.has(method) : method === 'publish' || method === 'subscribe';
            if (!supported || !operation || typeof operation !== 'object') return [];
            const op = operation as Record<string, unknown>;
            const caption = typeof op.operationId === 'string' ? op.operationId.slice(0, 480) : '';
            return [{ text: caption ? `${method.toUpperCase()} · ${caption}` : method.toUpperCase() }];
        });
        return [{ id: name, label: name, kind: id === 'openapi' ? 'useCase' : 'participant', members }];
    });
    return { nodes, edges: [] };
}

function scopedRecords(records: readonly SymbolRecord[], scope: string | null): SymbolRecord[] {
    if (!scope) return records.slice(0, MAX_NODES);
    return records.filter((record) => fileRefOf(record.ref) === fileRefOf(scope));
}

function classDiagram(graph: KnowledgeGraph, records: readonly SymbolRecord[], scope: string | null, composite: boolean): Diagram {
    const local = scopedRecords(records, scope);
    const owners = new Map(records.filter((record) => TYPES.has(record.kind)).map((record) => [bare(record.ref), record]));
    const selected = scope && owners.has(bare(scope)) ? owners.get(bare(scope)) : undefined;
    const ids = new Set((selected ? [selected] : local.filter((record) => TYPES.has(record.kind))).map((record) => record.ref));
    const refs = new Map(records.map((record) => [bare(record.ref), record]));
    const rels: DiagramEdge[] = [];
    const bind = (from: string, to: string, kind: string) => {
        if (!ASSOCIATIONS.has(kind) || composite && kind !== 'composes' && kind !== 'uses') return;
        const owner = (ref: string) => {
            const record = refs.get(bare(ref));
            return record && (TYPES.has(record.kind) ? record : owners.get(bare(record.parent)));
        };
        const a = owner(from), b = owner(to);
        if (a && b && a.ref !== b.ref && (ids.has(a.ref) || ids.has(b.ref))) rels.push({ from: a.ref, to: b.ref, kind });
    };
    for (const record of records) for (const rel of record.relations ?? []) bind(record.ref, rel.to, rel.kind);
    for (const edge of graph.edges) bind(edge.from, edge.to, edge.kind);
    const connected = new Set([...ids, ...rels.flatMap(({ from, to }) => [from, to])]);
    const member = (record: SymbolRecord): DiagramMember => ({
        text: `${record.exported ? '+ ' : ''}${record.name}${record.kind === 'method' || record.kind === 'function' ? '()' : ''}`,
        ref: record.ref,
    });
    const nodes = [...connected].slice(0, MAX_NODES).flatMap((id) => {
        const record = refs.get(bare(id));
        return record ? [{
            id, ref: id, label: record.name, kind: composite && id !== selected?.ref ? 'part' : record.kind,
            members: records.filter((memberRecord) => memberRecord.parent === id).sort((a, b) => a.line - b.line).map(member),
        }] : [];
    });
    if (!selected && scope) {
        const file = fileRefOf(scope);
        const declarations = local.filter((record) => record.parent === file && !TYPES.has(record.kind));
        if (declarations.length) nodes.unshift({ id: file, ref: file, label: tailOf(pathOf(file) ?? file), kind: 'package', members: declarations.map(member) });
    }
    const visible = new Set(nodes.map(({ id }) => id));
    const seen = new Set<string>();
    const edges = rels.filter(({ from, to, kind }) => {
        const key = JSON.stringify([from, to, kind]);
        if (!visible.has(from) || !visible.has(to) || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    return { nodes, edges };
}

function packageDiagram(graph: KnowledgeGraph, stations: readonly Station[], kind: 'package' | 'component' | 'system'): Diagram {
    const visible = new Set(stations.flatMap((s) => s.refs));
    const apps = modulesOfFiles(graph);
    const refs = new Map<string, string>();
    const nodes = new Map<string, DiagramNode>();
    for (const n of fileNodesOf(graph)) {
        if (!visible.has(n.ref) || !isArchitectureFile(n)) continue;
        const path = pathOf(n.ref);
        if (!path) continue;
        const dir = path.slice(0, Math.max(0, path.lastIndexOf('/')));
        const id = kind === 'system' ? systemOfNode(n) : kind === 'component' ? apps.get(n.ref) || appOfNode(n) || systemOfNode(n) || dir : dir;
        const key = `${kind}:${id}`;
        if (!nodes.has(key)) {
            if (nodes.size >= MAX_NODES) continue;
            nodes.set(key, { id: key, label: id || graph.scope.rootId, kind, ref: n.ref });
        }
        refs.set(n.ref, key);
    }
    const edges = new Map<string, DiagramEdge>();
    for (const edge of mapEdges(graph)) {
        if (!['references', 'imports', 'uses', 'calls'].includes(edge.kind)) continue;
        const from = refs.get(fileRefOf(edge.from)), to = refs.get(fileRefOf(edge.to));
        if (!from || !to || from === to) continue;
        const key = JSON.stringify([from, to]);
        const previous = edges.get(key);
        if (previous) previous.count = (previous.count ?? 1) + 1;
        else if (edges.size < MAX_EDGES) edges.set(key, { from, to, kind: 'references', count: 1 });
    }
    return { nodes: [...nodes.values()].sort((a, b) => cmp(a.label, b.label)), edges: [...edges.values()] };
}

function deployment(graph: KnowledgeGraph): Diagram {
    const units = new Set(deployUnitsOf(graph).map((node) => node.ref as string));
    const bindings = new Set(deployBindingsOf(graph).map((node) => node.ref as string));
    const nodeKind = new Map<string, string>([...[...units].map((id) => [id, 'node'] as const), ...[...bindings].map((id) => [id, 'data'] as const)]);
    for (const edge of graph.edges) if (edge.kind === 'mentions' && nodeKind.has(edge.to)) nodeKind.set(edge.from, 'artifact');
    const nodes = graph.nodes.flatMap((node) => {
        const kind = nodeKind.get(node.ref);
        return kind ? [{ id: node.ref, label: node.label, kind, ...(kind === 'artifact' ? { ref: node.ref } : {}) }] : [];
    });
    return { nodes, edges: graph.edges.filter((e) => nodeKind.has(e.from) && nodeKind.has(e.to)).map(({ from, to, kind }) => ({ from, to, kind })) };
}

function calls(graph: KnowledgeGraph, records: readonly SymbolRecord[], scope: string | null): Diagram {
    const index = callIndex(graph, records);
    const byRef = new Map(records.map((record) => [record.ref, record]));
    const inScope = scopedRecords(records, scope);
    const local = new Set(inScope.filter((record) => !scope || scope === fileRefOf(scope) || record.ref === scope || record.parent === scope).map((record) => record.ref));
    const nodes = new Map<string, DiagramNode>();
    const meet = (ref: string) => {
        if (nodes.has(ref) || nodes.size >= MAX_NODES) return;
        const record = byRef.get(ref);
        nodes.set(ref, { id: ref, label: record?.name ?? (isExternal(ref) ? externalName(ref) : tailOf(pathOf(fileRefOf(ref)) ?? ref)), kind: 'participant', ...(record ? { ref } : {}) });
    };
    const edges: DiagramEdge[] = [];
    for (const ref of local) {
        meet(ref);
        for (const call of index.calls.get(ref) ?? []) {
            meet(call.to);
            if (nodes.has(ref) && nodes.has(call.to) && edges.length < MAX_EDGES) edges.push({ from: ref, to: call.to, kind: 'calls' });
        }
    }
    return { nodes: [...nodes.values()], edges };
}

function endpoints(graph: KnowledgeGraph): Diagram {
    const nodes = fileNodesOf(graph).flatMap((node) => parseRoutes(node.badges?.routes).map((route, i) => ({
        id: `${node.ref}:${i}`, label: `${route.method} ${route.path}`, kind: 'useCase', ref: node.ref,
    }))).slice(0, MAX_NODES);
    return { nodes, edges: [] };
}

function dataFlow(graph: KnowledgeGraph): Diagram {
    const edges = graph.edges.filter((edge) => edge.kind === 'reads').slice(0, MAX_EDGES);
    const seen = new Set(edges.flatMap(({ from, to }) => [from, to]));
    const nodes = graph.nodes.filter((node) => seen.has(node.ref)).slice(0, MAX_NODES).map((node) => ({
        id: node.ref, label: node.label, kind: node.kind === 'file' ? 'process' : 'data',
        ...(node.kind === 'file' ? { ref: node.ref } : {}),
    }));
    const visible = new Set(nodes.map(({ id }) => id));
    return { nodes, edges: edges.filter(({ from, to }) => visible.has(from) && visible.has(to)).map(({ from, to, kind }) => ({ from, to, kind })) };
}

/** An overview groups recorded messages into their calling interactions. */
function interactions(diagram: Diagram): Diagram {
    const names = new Map(diagram.nodes.map((node) => [node.id, node.label]));
    const byCaller = new Map<string, DiagramMember[]>();
    for (const edge of diagram.edges) {
        const members = byCaller.get(edge.from) ?? [];
        if (!byCaller.has(edge.from)) byCaller.set(edge.from, members);
        const text = names.get(edge.to) ?? edge.to;
        if (!members.some((member) => member.text === text)) members.push({ text });
    }
    const nodes = diagram.nodes.filter((node) => byCaller.has(node.id)).map((node) => ({
        ...node, kind: 'interaction', members: byCaller.get(node.id)!,
    }));
    return { nodes, edges: diagram.edges.filter((edge) => edge.from !== edge.to && byCaller.has(edge.to)) };
}

/** Model derivation only uses indexed facts and scope. Other views accept authored or runtime evidence. */
export function sourceDiagram(id: DiagramId, graph: KnowledgeGraph, records: readonly SymbolRecord[], scope: string | null, stations: readonly Station[]): Diagram {
    switch (id) {
        case 'classDiagram': case 'c4Code': return classDiagram(graph, records, scope, false);
        case 'compositeDiagram': return classDiagram(graph, records, scope, true);
        case 'packageDiagram': case 'dsm': return packageDiagram(graph, stations, 'package');
        case 'componentDiagram': case 'c4Containers': case 'codeCity': return packageDiagram(graph, stations, 'component');
        case 'c4Components': return packageDiagram(graph, stations.filter((station) => !scope || station.refs.some((ref) => ref === fileRefOf(scope))), 'package');
        case 'c4Context': return packageDiagram(graph, stations, 'system');
        case 'deploymentDiagram': return deployment(graph);
        case 'useCaseDiagram': case 'openapi': return endpoints(graph);
        case 'interactionDiagram': return interactions(calls(graph, records, scope));
        case 'sequenceDiagram': case 'communicationDiagram': case 'callGraph': case 'msc':
            return calls(graph, records, scope);
        case 'dfd': case 'dfdGane': case 'lineage': return dataFlow(graph);
        case 'hotspots': return {
            nodes: [...stations].sort((a, b) => (b.churn ?? 0) - (a.churn ?? 0)).filter((s) => s.churn !== undefined).slice(0, MAX_NODES)
                .map((s) => ({ id: s.id, label: s.name, kind: 'component', members: [{ text: ((s.churn ?? 0) * 100).toFixed(0) + '%' }] })),
            edges: [],
        };
        default: return EMPTY_DIAGRAM;
    }
}

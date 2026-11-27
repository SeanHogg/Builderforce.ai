import type { KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { callIndex, externalName, isExternal } from '../../compute/tasks/placement/callIndex';
import { deployBindingsOf, deployUnitsOf } from '../../deployFacts';
import { pathOf } from '../../graphModel';
import { cmp } from '../../order';
import type { SymbolRecord } from '../../types';
import { parseRoutes } from '../drawers/apiModel';
import { fileNodesOf, isArchitectureFile, mapEdges, tailOf } from '../outlineGraph';
import { fileRefOf, type Station } from '../stations';
import { modulesOfFiles, systemOfNode } from '../systems';
import type { DiagramId } from './catalog';

export interface DiagramMember { text: string; ref?: string }
export interface DiagramNode {
    id: string; label: string; kind: string;
    ref?: string;
    members?: DiagramMember[];
    /** Positions from authored evidence. Timing uses x as the measured time. */
    x?: number; y?: number;
    /** Optional enclosing pool, trust boundary, context or layer. */
    group?: string;
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
            || !coordinate(node.x) || !coordinate(node.y) || node.group !== undefined && !string(node.group, 160)) return null;
        if (node.members !== undefined && (!Array.isArray(node.members) || node.members.length > 100 ||
            node.members.some((member) => !member || !string(member.text) || member.ref !== undefined))) return null;
        ids.add(node.id);
    }
    const count = (x: unknown) => x === undefined || typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= 1e9;
    for (const edge of edges) {
        if (!edge || !ids.has(edge.from) || !ids.has(edge.to) || !string(edge.kind, 40)
            || edge.label !== undefined && !string(edge.label) || !coordinate(edge.time) || !count(edge.count)) return null;
    }
    return { nodes, edges };
}

/** OpenAPI and AsyncAPI JSON can be used directly. Only operation and channel metadata is read. */
export function diagramFromFile(id: DiagramId, value: unknown): Diagram | null {
    const checked = checkedDiagram(value);
    if (checked) {
        if (id === 'timingDiagram' && checked.nodes.some((node) => node.x === undefined)) return null;
        if (id === 'communicationDiagram' &&
            checked.edges.length && checked.edges.every((edge) => edge.time !== undefined)) {
            return { ...checked, edges: [...checked.edges].sort((a, b) => a.time! - b.time!) };
        }
        return checked;
    }
    if (!value || typeof value !== 'object') return null;
    const contract = value as Record<string, unknown>;
    const matches = id === 'openapi' ? typeof contract.openapi === 'string' || contract.swagger === '2.0'
        : id === 'asyncapi' && typeof contract.asyncapi === 'string';
    if (!matches) return null;
    const entries = id === 'openapi' ? contract.paths : contract.channels;
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return null;
    const httpMethods = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);
    const caption = (method: string, operation: unknown) => {
        const op = operation && typeof operation === 'object' ? (operation as Record<string, unknown>).operationId : undefined;
        const name = typeof op === 'string' ? op.slice(0, 480) : '';
        return name ? `${method} · ${name}` : method;
    };
    // AsyncAPI 3 moves send / receive out of the channel into top-level operations that point back at it.
    const v3 = id === 'asyncapi' && /^3(?:\.|$)/.test(String(contract.asyncapi));
    const byChannel = new Map<string, DiagramMember[]>();
    if (v3 && contract.operations && typeof contract.operations === 'object' && !Array.isArray(contract.operations)) {
        for (const [opId, operation] of Object.entries(contract.operations)) {
            if (!operation || typeof operation !== 'object') continue;
            const { action, channel } = operation as { action?: unknown; channel?: { $ref?: unknown } };
            if (action !== 'send' && action !== 'receive' || typeof channel?.$ref !== 'string') continue;
            const target = channelNameFromRef(channel.$ref);
            if (target === null) continue;
            const members = byChannel.get(target) ?? [];
            if (!byChannel.has(target)) byChannel.set(target, members);
            if (members.length < 100) members.push({ text: `${action.toUpperCase()} · ${opId}`.slice(0, 512) });
        }
    }
    const nodes = Object.entries(entries).slice(0, MAX_NODES).flatMap(([name, entry]) => {
        if (!entry || typeof entry !== 'object' || !name || name.length > 512) return [];
        const members = v3 ? byChannel.get(name) ?? [] : Object.entries(entry).flatMap(([method, operation]) => {
            const supported = id === 'openapi' ? httpMethods.has(method) : method === 'publish' || method === 'subscribe';
            return supported && operation && typeof operation === 'object' ? [{ text: caption(method.toUpperCase(), operation) }] : [];
        });
        return [{ id: name, label: name, kind: id === 'openapi' ? 'useCase' : 'participant', members }];
    });
    return { nodes, edges: [] };
}

function channelNameFromRef(ref: string): string | null {
    if (!ref.startsWith('#')) return null;
    try {
        const [prefix, section, name, ...nested] = decodeURIComponent(ref.slice(1)).split('/');
        if (prefix || section !== 'channels' || !name || nested.length) return null;
        return name.replaceAll('~1', '/').replaceAll('~0', '~');
    } catch { return null; }
}

function scopedRecords(records: readonly SymbolRecord[], scope: string | null): SymbolRecord[] {
    if (!scope) return records.slice(0, MAX_NODES);
    return records.filter((record) => fileRefOf(record.ref) === fileRefOf(scope));
}

function classDiagram(graph: KnowledgeGraph, records: readonly SymbolRecord[], scope: string | null, composite: boolean): Diagram {
    const local = scopedRecords(records, scope);
    const owners = new Map(records.filter((record) => TYPES.has(record.kind)).map((record) => [bare(record.ref), record]));
    const refs = new Map(records.map((record) => [bare(record.ref), record]));
    // A method or field selects the class that owns it, not the whole file.
    const selected = scope ? owners.get(bare(scope)) ?? owners.get(bare(refs.get(bare(scope))?.parent ?? '')) : undefined;
    const ids = new Set((selected ? [selected] : local.filter((record) => TYPES.has(record.kind))).map((record) => record.ref));
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

const directoryOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));

function componentOf(node: KNode, apps: ReadonlyMap<string, string>): string {
    return apps.get(node.ref) || systemOfNode(node) || directoryOf(pathOf(node.ref) ?? '');
}

function packageDiagram(graph: KnowledgeGraph, stations: readonly Station[], kind: 'package' | 'component' | 'system', filter?: (ref: string) => boolean): Diagram {
    const visible = new Set(stations.flatMap((s) => s.refs));
    const apps = modulesOfFiles(graph);
    const refs = new Map<string, string>();
    const nodes = new Map<string, DiagramNode>();
    for (const n of fileNodesOf(graph)) {
        if (!visible.has(n.ref) || !isArchitectureFile(n) || filter && !filter(n.ref)) continue;
        const path = pathOf(n.ref);
        if (!path) continue;
        const system = systemOfNode(n);
        const id = kind === 'system' ? system : kind === 'component' ? componentOf(n, apps) : directoryOf(path);
        const key = kind === 'component' && system ? `${kind}:${JSON.stringify([system, id])}` : `${kind}:${id}`;
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
    const edges = graph.edges.filter((edge) => edge.kind === 'reads' || edge.kind === 'writes').slice(0, MAX_EDGES);
    const seen = new Set(edges.flatMap(({ from, to }) => [from, to]));
    const nodes = graph.nodes.filter((node) => seen.has(node.ref)).slice(0, MAX_NODES).map((node) => ({
        id: node.ref, label: node.label, kind: node.kind === 'file' ? 'process' : 'data',
        ...(node.kind === 'file' ? { ref: node.ref } : {}),
    }));
    const visible = new Set(nodes.map(({ id }) => id));
    return { nodes, edges: edges.filter(({ from, to }) => visible.has(from) && visible.has(to))
        .map(({ from, to, kind }) => kind === 'reads' ? { from: to, to: from, kind } : { from, to, kind }) };
}

function contextMap(graph: KnowledgeGraph, scope: string | null): Diagram {
    const byFile = new Map<string, string>();
    const groups = new Map<string, DiagramNode>();
    for (const node of fileNodesOf(graph)) {
        if (!isArchitectureFile(node)) continue;
        const path = pathOf(node.ref);
        const boundary = path?.match(/^((?:.*\/)?domains\/)([^/]+)(?:\/|$)/);
        if (!boundary) continue;
        const id = boundary[1]! + boundary[2]!;
        byFile.set(node.ref, id);
        if (!groups.has(id)) groups.set(id, { id, label: boundary[2]!, kind: 'component', ref: node.ref, group: systemOfNode(node) });
    }
    const routes = new Map<string, DiagramEdge>();
    const owner = scope ? byFile.get(fileRefOf(scope)) : undefined;
    for (const edge of mapEdges(graph)) {
        if (!['imports', 'uses', 'calls', 'references'].includes(edge.kind)) continue;
        const from = byFile.get(fileRefOf(edge.from)), to = byFile.get(fileRefOf(edge.to));
        if (!from || !to || from === to || owner && from !== owner && to !== owner) continue;
        const key = JSON.stringify([from, to]), previous = routes.get(key);
        if (previous) previous.count = (previous.count ?? 1) + 1;
        else if (routes.size < MAX_EDGES) routes.set(key, { from, to, kind: 'references', count: 1 });
    }
    const visible = new Set<string>();
    for (const { from, to } of routes.values()) { visible.add(from); visible.add(to); }
    const nodes = [...groups.values()].filter((node) => !owner || owner === node.id || visible.has(node.id)).slice(0, MAX_NODES);
    const selected = new Set(nodes.map((node) => node.id));
    return { nodes, edges: [...routes.values()].filter(({ from, to }) => selected.has(from) && selected.has(to)) };
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

function c4Scope(graph: KnowledgeGraph, scope: string | null, module: boolean): ((ref: string) => boolean) | undefined {
    if (!scope) return undefined;
    const ownerRef = fileRefOf(scope);
    const files = new Map(fileNodesOf(graph).map((node) => [node.ref as string, node]));
    const owner = files.get(ownerRef);
    if (!owner) return undefined;
    const apps = modulesOfFiles(graph);
    const system = systemOfNode(owner);
    const app = componentOf(owner, apps);
    return (ref) => {
        const node = files.get(ref);
        return !!node && systemOfNode(node) === system && (!module || componentOf(node, apps) === app);
    };
}

/** Model derivation only uses indexed facts and scope. Other views accept authored or runtime evidence. */
export function sourceDiagram(id: DiagramId, graph: KnowledgeGraph, records: readonly SymbolRecord[], scope: string | null, stations: readonly Station[]): Diagram {
    switch (id) {
        case 'classDiagram': case 'c4Code': return classDiagram(graph, records, scope, false);
        case 'compositeDiagram': return classDiagram(graph, records, scope, true);
        case 'packageDiagram': case 'dsm': return packageDiagram(graph, stations, 'package');
        case 'componentDiagram': return packageDiagram(graph, stations, 'component');
        case 'c4Containers': return packageDiagram(graph, stations, 'component', c4Scope(graph, scope, false));
        case 'c4Components': return packageDiagram(graph, stations, 'package', c4Scope(graph, scope, true));
        case 'c4Context': return packageDiagram(graph, stations, 'system');
        case 'deploymentDiagram': return deployment(graph);
        case 'useCaseDiagram': case 'openapi': return endpoints(graph);
        case 'interactionDiagram': return interactions(calls(graph, records, scope));
        case 'communicationDiagram': case 'callGraph':
            return calls(graph, records, scope);
        case 'dfd': case 'dfdGane': case 'lineage': return dataFlow(graph);
        case 'contextMap': return contextMap(graph, scope);
        case 'hotspots': return {
            nodes: [...stations].sort((a, b) => (b.churn ?? 0) - (a.churn ?? 0)).filter((s) => s.churn !== undefined).slice(0, MAX_NODES)
                .map((s) => ({ id: s.id, label: s.name, kind: 'component', members: [{ text: ((s.churn ?? 0) * 100).toFixed(0) + '%' }] })),
            edges: [],
        };
        default: return EMPTY_DIAGRAM;
    }
}

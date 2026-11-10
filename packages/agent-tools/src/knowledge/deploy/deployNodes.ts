/**
 * knowledge/deploy/deployNodes.ts — deployable units on memory's knowledge graph, in memory's OWN vocabulary (no kind
 * is invented here; memory's pack format names node kinds `file | section | symbol | area | entity | claim | fact`):
 *
 *   unit     → an `entity` node, `ent:code:unit:<descriptor>#<key>` (the unit's stable key, percent-encoded), badge
 *              `type: deployable-unit` (memory's entity card already reads `type`), plus `unitKind`, `runtime`, `ports`,
 *              `env` (names), `cron`, `source`, `bindings`, `produces` / `consumes` (queues) and `externals`;
 *   binding  → an `entity` node ({@link bindingRef}), badge `type: deploy-binding`, `bindingKind`; shared by every unit
 *              that binds the same resource, scoped to its descriptor when it names none;
 *   edges    → descriptor file `mentions` unit (where it is declared) · unit `contains` file (what it deploys; a folder
 *              or extension-less target is re-pointed to a real file when the graph is built, `deployGraph.ts`) ·
 *              unit `references` unit (`depends_on`, links, selectors, `needs`) · unit `references` binding.
 *
 * The edge's meaning is read from its ends (an edge carries no attributes): `references` to a unit is a dependency,
 * to a binding a binding. Pure.
 */

import { compareStr, srcRef, type ExternalServiceId, type KEdge, type KNode, type NodeRef } from '@seanhogg/builderforce-memory/knowledge';
import { CODE_BADGES, CODE_PACK_ID } from '../codeNodes.js';
import type { BindingKind, DeployBinding, DeployUnit } from './deployModel.js';

/** The `type` badge values (memory's entity card reads `type`). */
export const DEPLOY_TYPES = { unit: 'deployable-unit', binding: 'deploy-binding' } as const;

/** Badges on unit and binding nodes, and on the descriptor's file node. The view reads them by these names. */
export const DEPLOY_BADGES = {
    type: 'type',
    unitKind: 'unitKind',
    runtime: 'runtime',
    /** Comma-joined port numbers. */
    ports: 'ports',
    /** Comma-joined env var NAMES (capped at 40). */
    env: 'env',
    /** `;`-joined schedules. */
    cron: 'cron',
    /** Comma-joined root-relative folders / files it builds from ('.' = the root). */
    source: 'source',
    /** Comma-joined `kind:name` of its bindings. */
    bindings: 'bindings',
    /** Comma-joined queue names it sends to / consumes. */
    produces: 'produces',
    consumes: 'consumes',
    externals: CODE_BADGES.externals,
    /** Binding nodes: what kind of resource it is. */
    bindingKind: 'bindingKind',
    /** The descriptor's file node: its family (`wrangler`, `compose`, …) and how many units it declares. */
    deploy: 'deploy',
    units: 'units',
    /** A package.json's `workspaces` globs, comma-joined. */
    workspaces: 'workspaces',
} as const;

/** The memory edge kinds the deploy facts ride on (see the file comment). */
export const DEPLOY_EDGE_KINDS = { declares: 'mentions', deploys: 'contains', dependsOn: 'references', binds: 'references' } as const;

const UNIT_PREFIX = `ent:${CODE_PACK_ID}:unit:`;
const BINDING_PREFIX = `ent:${CODE_PACK_ID}:binding:`;
/** A key in a ref: percent-encoded, so it never holds the `#` that ends the descriptor path. */
const encodeKey = (key: string): string => encodeURIComponent(key);

/** `ent:code:unit:<descriptor>#<key>` — the descriptor path is everything before the LAST `#` (the key holds none). */
export const unitRef = (descriptorPath: string, key: string): NodeRef => `${UNIT_PREFIX}${descriptorPath}#${encodeKey(key)}`;
/**
 * A binding with a resource identity (bucket, database, queue, object class, service) is ONE node for every unit that
 * binds it: `ent:code:binding:<kind>:<resource>`. One without (a KV binding name, a compose volume) is scoped to its
 * descriptor: `ent:code:binding:<kind>:<descriptor>#<name>` — two Workers' `CACHE` bindings are not one store.
 */
export const bindingRef = (descriptorPath: string, b: Pick<DeployBinding, 'kind' | 'name' | 'resource'>): NodeRef =>
    b.resource !== undefined ? `${BINDING_PREFIX}${b.kind}:${b.resource}` : `${BINDING_PREFIX}${b.kind}:${descriptorPath}#${encodeKey(b.name)}`;
export const isUnitRef = (ref: string): boolean => ref.startsWith(UNIT_PREFIX);
/** The descriptor path a unit ref was declared in; undefined for any other ref. */
export const descriptorOfUnit = (ref: string): string | undefined =>
    isUnitRef(ref) ? ref.slice(UNIT_PREFIX.length, ref.lastIndexOf('#')) : undefined;

/** The binding kinds that ARE one of memory's known outside services (the terminus table's ids). */
const SERVICE_OF: Partial<Record<BindingKind, ExternalServiceId>> = { kv: 'kv', r2: 'kv', hyperdrive: 'postgres', ai: 'llm' };

/** How many names one list badge keeps. */
const MAX_LISTED = 40;
const listed = (xs: readonly string[], sep = ','): string => xs.slice(0, MAX_LISTED).join(sep);

function put(badges: Record<string, number | string>, key: string, value: string): void {
    if (value !== '') badges[key] = value;
}

function unitNode(ref: NodeRef, u: DeployUnit): KNode {
    const badges: Record<string, number | string> = { [DEPLOY_BADGES.type]: DEPLOY_TYPES.unit, [DEPLOY_BADGES.unitKind]: u.kind };
    put(badges, DEPLOY_BADGES.runtime, u.runtime ?? '');
    put(badges, DEPLOY_BADGES.ports, listed(u.ports.map(String)));
    put(badges, DEPLOY_BADGES.env, listed([...u.env].sort(compareStr)));
    put(badges, DEPLOY_BADGES.cron, listed(u.cron, ';'));
    put(badges, DEPLOY_BADGES.source, listed(u.sources.map((s) => s || '.')));
    put(badges, DEPLOY_BADGES.bindings, listed(u.bindings.map((b) => `${b.kind}:${b.name}`)));
    put(badges, DEPLOY_BADGES.produces, listed(u.bindings.filter((b) => b.direction === 'produces').map((b) => b.resource ?? b.name)));
    put(badges, DEPLOY_BADGES.consumes, listed(u.bindings.filter((b) => b.direction === 'consumes').map((b) => b.resource ?? b.name)));
    const externals = [...new Set(u.bindings.map((b) => SERVICE_OF[b.kind]).filter((s): s is ExternalServiceId => !!s))].sort(compareStr);
    put(badges, DEPLOY_BADGES.externals, externals.join(','));
    return { ref, kind: 'entity', label: u.name, pack: CODE_PACK_ID, importance: 0, origin: 'extracted', badges };
}

function bindingNode(descriptorPath: string, b: DeployBinding): KNode {
    const badges: Record<string, number | string> = { [DEPLOY_BADGES.type]: DEPLOY_TYPES.binding, [DEPLOY_BADGES.bindingKind]: b.kind };
    const service = SERVICE_OF[b.kind];
    if (service) badges[DEPLOY_BADGES.externals] = service;
    return { ref: bindingRef(descriptorPath, b), kind: 'entity', label: b.resource ?? b.name, pack: CODE_PACK_ID, importance: 0, origin: 'extracted', badges };
}

const edge = (from: NodeRef, to: NodeRef, kind: string): KEdge => ({ from, to, kind, weight: 1, origin: 'extracted' });

/** The nodes and edges of one descriptor's units. Each unit's ref is its stable `key`; dependencies name keys. */
export function deployGraphOf(rootId: string, descriptorPath: string, units: readonly DeployUnit[]): { nodes: KNode[]; edges: KEdge[] } {
    const refOf = new Map(units.map((u) => [u.key, unitRef(descriptorPath, u.key)] as const));
    const nodes = new Map<NodeRef, KNode>();
    const edges = new Map<string, KEdge>();
    const add = (e: KEdge): void => { edges.set(`${e.from}\0${e.to}\0${e.kind}`, e); };
    const file = srcRef(rootId, descriptorPath);
    for (const u of units) {
        const ref = refOf.get(u.key)!;
        if (nodes.has(ref)) continue;
        nodes.set(ref, unitNode(ref, u));
        add(edge(file, ref, DEPLOY_EDGE_KINDS.declares));
        for (const s of u.sources) if (s !== descriptorPath) add(edge(ref, srcRef(rootId, s), DEPLOY_EDGE_KINDS.deploys));
        for (const dep of u.dependsOn) {
            const to = refOf.get(dep);
            if (to && to !== ref) add(edge(ref, to, DEPLOY_EDGE_KINDS.dependsOn));
        }
        for (const b of u.bindings) {
            const node = bindingNode(descriptorPath, b);
            if (!nodes.has(node.ref)) nodes.set(node.ref, node);
            add(edge(ref, node.ref, DEPLOY_EDGE_KINDS.binds));
        }
    }
    const byRef = (a: { ref: string }, b: { ref: string }): number => compareStr(a.ref, b.ref);
    return {
        nodes: [...nodes.values()].sort(byRef),
        edges: [...edges.values()].sort((a, b) => compareStr(a.from, b.from) || compareStr(a.to, b.to) || compareStr(a.kind, b.kind)),
    };
}

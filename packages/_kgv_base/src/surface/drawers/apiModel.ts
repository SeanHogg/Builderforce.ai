/**
 * The API drawer's data, all client-side: the `routes` badge parsed into endpoints, who calls
 * each one (the stations that import its file), whether an OpenAPI document in the graph
 * documents it, and the three things a person takes away: a curl line, an OpenAPI skeleton and
 * a Postman collection. Nothing is invented: with no OpenAPI document in the graph, every
 * endpoint is undocumented, and the drawer says the contract is missing.
 */

import type { KnowledgeGraph, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { cmp } from '../../order';
import { stationOfRef, type StationModel } from '../stations';

export interface Route { method: string; path: string }

export interface Endpoint extends Route {
    /** The file that registers it. */
    file: string;
    fileName: string;
    stationId?: string;
    /** Names of the other stations that import the file. */
    callers: string[];
    documented: boolean;
}

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'ALL']);

/** `GET /a;POST /b` to routes; entries that are not `METHOD /path` are dropped. */
export function parseRoutes(value: string | number | undefined): Route[] {
    const out: Route[] = [];
    for (const entry of String(value ?? '').split(';')) {
        const [method, ...rest] = entry.trim().split(/\s+/);
        const path = rest.join(' ');
        if (method && METHODS.has(method.toUpperCase()) && path.startsWith('/')) out.push({ method: method.toUpperCase(), path });
    }
    return out;
}

const OPENAPI_FILE = /(^|\/)(openapi|swagger)[^/]*\.(json|ya?ml)$/i;

/** The OpenAPI documents in the graph. */
export const openApiDocs = (nodes: readonly KNode[]): KNode[] => nodes.filter((n) => n.kind === 'file' && OPENAPI_FILE.test(n.label));

/** An operation is documented when a node inside an OpenAPI document names its path. */
function documentedIn(inDoc: readonly KNode[], route: Route): boolean {
    const normal = toOpenApiPath(route.path);
    return inDoc.some((n) => { const words = n.label.split(/\s+/); return words.includes(route.path) || words.includes(normal); });
}

export function endpointsOf(graph: Pick<KnowledgeGraph, 'nodes' | 'edges'>, model: Pick<StationModel, 'stationOf' | 'byId'>): Endpoint[] {
    const docs = openApiDocs(graph.nodes);
    // The nodes inside an OpenAPI document, found once for every route.
    const inDoc = docs.length === 0 ? [] : graph.nodes.filter((n) => docs.some((d) => n.ref.startsWith(`${d.ref}#`)));
    const importers = new Map<string, Set<string>>();
    for (const e of graph.edges) {
        if (e.kind !== 'references') continue;
        const from = stationOfRef(model, e.from);
        if (from) (importers.get(e.to) ?? importers.set(e.to, new Set()).get(e.to)!).add(from);
    }
    const out: Endpoint[] = [];
    for (const n of graph.nodes) {
        if (n.kind !== 'file' || n.badges?.routes === undefined) continue;
        const own = stationOfRef(model, n.ref);
        const callers = [...(importers.get(n.ref) ?? [])].filter((id) => id !== own).flatMap((id) => model.byId.get(id)?.name ?? []).sort(cmp);
        for (const r of parseRoutes(n.badges.routes)) {
            out.push({ ...r, file: n.ref, fileName: n.label, ...(own ? { stationId: own } : {}), callers, documented: documentedIn(inDoc, r) });
        }
    }
    return out.sort((a, b) => cmp(a.fileName, b.fileName) || cmp(a.path, b.path) || cmp(a.method, b.method));
}

/** Endpoints grouped by their file, files in order. */
export function groupByFile(endpoints: readonly Endpoint[]): Array<{ file: string; fileName: string; stationId?: string; endpoints: Endpoint[] }> {
    const groups = new Map<string, { file: string; fileName: string; stationId?: string; endpoints: Endpoint[] }>();
    for (const e of endpoints) {
        const g = groups.get(e.file) ?? groups.set(e.file, { file: e.file, fileName: e.fileName, ...(e.stationId ? { stationId: e.stationId } : {}), endpoints: [] }).get(e.file)!;
        g.endpoints.push(e);
    }
    return [...groups.values()];
}

/** `/users/:id` becomes `/users/{id}`. */
export const toOpenApiPath = (path: string): string => path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

const pathParams = (path: string): string[] => [...toOpenApiPath(path).matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!);

/** The request line of an endpoint, as a person reads it. */
export const requestLine = (e: Route): string => `${e.method} ${e.path}`;

/** Whether a method carries a request body. THE one rule (the parameter list, the curl line, the sandbox and the request builder all read it). */
export const bodyMethod = (method: string): boolean => method === 'POST' || method === 'PUT' || method === 'PATCH';

/** `curl` for an endpoint against `$BASE_URL`; a body-bearing method sends an empty JSON object. */
export function curlOf(e: Route): string {
    const body = bodyMethod(e.method) ? " -H 'Content-Type: application/json' -d '{}'" : '';
    return `curl -X ${e.method === 'ALL' ? 'GET' : e.method} "$BASE_URL${e.path}"${body}`;
}

export interface OpenApiSkeleton {
    openapi: string;
    info: { title: string; version: string };
    paths: Record<string, Record<string, unknown>>;
}

/** An OpenAPI 3 skeleton: every endpoint, its path parameters and a placeholder response. */
export function openApiSkeleton(endpoints: readonly Route[], title: string): OpenApiSkeleton {
    const paths: OpenApiSkeleton['paths'] = {};
    for (const e of endpoints) {
        const key = toOpenApiPath(e.path);
        const methods = e.method === 'ALL' ? ['get', 'post', 'put', 'patch', 'delete'] : [e.method.toLowerCase()];
        const params = pathParams(e.path).map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } }));
        for (const m of methods) {
            (paths[key] ?? (paths[key] = {}))[m] = { summary: requestLine(e), ...(params.length ? { parameters: params } : {}), responses: { '200': { description: 'OK' } } };
        }
    }
    return { openapi: '3.0.3', info: { title, version: '0.0.0' }, paths };
}

/** A Postman v2.1 collection: one request per endpoint against `{{baseUrl}}`. */
export function postmanCollection(endpoints: readonly Route[], name: string): unknown {
    return {
        info: { name, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
        variable: [{ key: 'baseUrl', value: 'http://localhost:3000' }],
        item: endpoints.map((e) => ({
            name: requestLine(e),
            request: {
                method: e.method === 'ALL' ? 'GET' : e.method,
                url: { raw: `{{baseUrl}}${e.path}`, host: ['{{baseUrl}}'], path: e.path.split('/').filter(Boolean) },
            },
        })),
    };
}

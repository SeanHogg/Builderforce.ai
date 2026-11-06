/**
 * What the API drawer says about ONE endpoint, all read from the graph: its parameters (the
 * route path's own, plus the body a body-bearing method takes), the test files that reference
 * the handler ("responses tested"), and the files that reference it (its callers). Also the
 * split of the list into "in contract" and "undocumented". Pure; nothing is invented: a body
 * whose shape the route extraction did not capture is marked as such.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { cmp } from '../../order';
import { labelFor, nodeIndex, pathOf } from '../../graphModel';
import { bodyMethod, type Endpoint, type Route } from './apiModel';
import { isTestPath } from './testShapeModel';

export type ParamWhere = 'path' | 'query' | 'body';

export interface ParamRow {
    name: string;
    where: ParamWhere;
    /** `route` = read from the registered path; `unknown-shape` = the method takes a body the extraction cannot describe. */
    source: 'route' | 'unknown-shape';
}

export interface FileRef { ref: string; name: string }

export interface EndpointDetail {
    params: ParamRow[];
    /** Test files that reference the handler's file. */
    testFiles: FileRef[];
    /** Non-test files that reference the handler's file. */
    callerFiles: FileRef[];
    tested: boolean;
}

/** One stable key per parameter: a path param and a query param of the same name are different fields. */
export const paramKey = (p: Pick<ParamRow, 'where' | 'name'>): string => `${p.where}:${p.name}`;

/** One stable key per endpoint (a file may register the same path under two methods). */
export const endpointKey = (e: Pick<Endpoint, 'file' | 'method' | 'path'>): string => `${e.file}|${e.method} ${e.path}`;

/** Path parameters (`:id`, `{id}`), query parameters written into the path (`?a=&b=`), and a body for POST/PUT/PATCH. */
export function paramsOf(route: Route): ParamRow[] {
    const [pathPart = '', query = ''] = route.path.split('?', 2);
    const out: ParamRow[] = [];
    for (const m of pathPart.matchAll(/:([A-Za-z0-9_]+)|\{([^}]+)\}/g)) out.push({ name: (m[1] ?? m[2])!, where: 'path', source: 'route' });
    for (const pair of query.split('&')) {
        const name = pair.split('=')[0]!.trim();
        if (name) out.push({ name, where: 'query', source: 'route' });
    }
    if (bodyMethod(route.method)) out.push({ name: 'body', where: 'body', source: 'unknown-shape' });
    return out;
}

/** The files that reference each target, by the graph's `references` edges. Built once per graph. */
export function referrersOf(graph: Pick<KnowledgeGraph, 'nodes' | 'edges'>): Map<string, FileRef[]> {
    const index = nodeIndex(graph);
    const out = new Map<string, Map<string, FileRef>>();
    for (const e of graph.edges) {
        if (e.kind !== 'references' || e.from === e.to) continue;
        const from = index.get(e.from);
        if (from?.kind !== 'file') continue;
        (out.get(e.to) ?? out.set(e.to, new Map()).get(e.to)!).set(e.from, { ref: e.from, name: labelFor(index, e.from) });
    }
    return new Map([...out].map(([to, files]) => [to, [...files.values()].sort((a, b) => cmp(a.name, b.name) || cmp(a.ref, b.ref))]));
}

const isTestFile = (f: FileRef): boolean => isTestPath(pathOf(f.ref) ?? f.name);

export function detailOf(referrers: ReadonlyMap<string, readonly FileRef[]>, e: Endpoint): EndpointDetail {
    const from = referrers.get(e.file) ?? [];
    const testFiles = from.filter(isTestFile);
    return { params: paramsOf(e), testFiles, callerFiles: from.filter((f) => !isTestFile(f)), tested: testFiles.length > 0 };
}

/** The list split the way the drawer groups it. */
export function splitContract(endpoints: readonly Endpoint[]): { inContract: Endpoint[]; undocumented: Endpoint[] } {
    return { inContract: endpoints.filter((e) => e.documented), undocumented: endpoints.filter((e) => !e.documented) };
}

/** The endpoints a selection names, in list order. */
export const selected = (endpoints: readonly Endpoint[], keys: ReadonlySet<string>): Endpoint[] => endpoints.filter((e) => keys.has(endpointKey(e)));

/**
 * knowledge/codeRoutes.ts — deterministic scan for Hono / Express route registrations
 * (PRD 38, Option B+ Contract 1: the `routes` badge).
 *
 *   app.get('/x', h)  ·  router.post("/y", h)  ·  app.route('/api', sub)
 *   router.route('/z').get(h).post(h)  ·  app.get('/a', h).post('/b', h)
 *
 * Narrow on purpose, because a wrong route is worse than a missing one:
 *   • the file must be a router file — it imports hono / express / a router, or defines
 *     `new Hono(` / `express.Router(`; test and spec files never are;
 *   • a registration is `receiver.method('/path', handler…)` — a path literal that starts
 *     with `/` AND a handler argument after it. `axios.get('/x')`, `api.get(`/x/${id}`)` and
 *     `request(app).get('/x')` (a test client) are not registrations;
 *   • receivers that hold data or clients (`c`, `ctx`, `cache`, `axios`, `api`, …) are ignored;
 *   • a chained call (`).post('/b', h)`) counts only when it chains from a registration.
 * Comments are masked, so a commented-out route is not a route. The badge is `METHOD path`
 * entries joined by `;`, in source order, capped at {@link MAX_ROUTES}. Pure.
 */

import { isTestSourcePath } from '../symbols.js';
import { maskSource } from './codeMask.js';

export const MAX_ROUTES = 50;

const METHODS = 'get|post|put|patch|delete|options|head|all';
/** Receivers that hold data, or are HTTP clients, not routers. */
const NOT_ROUTERS: ReadonlySet<string> = new Set([
    'c', 'ctx', 'context', 'req', 'res', 'request', 'response', 'headers', 'params', 'query', 'cache', 'map', 'store', 'env', 'url', 'searchParams',
    'axios', 'api', 'http', 'https', 'client', 'agent', 'supertest', 'fetcher', 'got', 'ky',
]);

/** A file is a router file when it imports a router framework or builds a router. */
const ROUTER_FILE = new RegExp(
    String.raw`\bfrom\s*['"](?:hono(?:/[^'"]*)?|@hono/[^'"]*|express|fastify|koa-router|@koa/router|[^'"]*/router(?:\.js)?)['"]`
    + String.raw`|\brequire\s*\(\s*['"](?:express|hono)['"]\s*\)|\bnew\s+Hono\b|\bexpress\.Router\s*\(|\bRouter\s*\(\s*\)`,
);

/** `receiver.method('/path'` then an optional `,` (a handler follows). */
const REGISTRATION = new RegExp(String.raw`([A-Za-z_$][\w$]*)\s*\.\s*(${METHODS}|route)\s*\(\s*(['"` + '`' + String.raw`])(/[^'"` + '`' + String.raw`]*)\3\s*(,)?`, 'g');
/** The next call of a chain whose path is a literal and which has a handler. */
const NEXT_WITH_PATH = new RegExp(String.raw`\s*\.\s*(${METHODS})\s*\(\s*(['"` + '`' + String.raw`])(/[^'"` + '`' + String.raw`]*)\2\s*,`, 'y');
/** The next call of a `.route('/x')` chain: any handlers. */
const NEXT_ANY = new RegExp(String.raw`\s*\.\s*(${METHODS})\s*\(`, 'y');

const MAX_CALL_SCAN = 50_000;

/** The index just after the `)` that balances the `(` at `open`, skipping string literals; -1 when none. */
function afterCall(src: string, open: number): number {
    let depth = 0;
    const stop = Math.min(src.length, open + MAX_CALL_SCAN);
    for (let i = open; i < stop; i++) {
        const ch = src[i]!;
        if (ch === '"' || ch === "'" || ch === '`') {
            for (i++; i < stop && src[i] !== ch; i++) if (src[i] === '\\') i++;
            continue;
        }
        if (ch === '(') depth++;
        else if (ch === ')' && --depth === 0) return i + 1;
    }
    return -1;
}

// Test and spec files register throwaway routes; they are never the service's surface (`isTestSourcePath`).
const isRouterFile = (path: string, code: string): boolean => !isTestSourcePath(path) && ROUTER_FILE.test(code);

const entryOf = (method: string, path: string): string => `${method === 'route' ? 'ROUTE' : method.toUpperCase()} ${path}`;

/** Registrations of a router file, in source order. `code` is the source with comments masked (computed when omitted). */
export function scanRoutes(text: string, path = '', code = maskSource(text, 'js').code): string[] {
    if (!isRouterFile(path, code)) return [];
    const found: Array<{ at: number; entry: string }> = [];
    for (const m of code.matchAll(REGISTRATION)) {
        const [whole, receiver, method, , routePath, comma] = m;
        if (receiver && NOT_ROUTERS.has(receiver)) continue;
        if (routePath!.includes('${')) continue;
        const open = m.index! + whole!.indexOf('(');
        let end = afterCall(code, open);
        if (comma) found.push({ at: m.index!, entry: entryOf(method!.toLowerCase(), routePath!) });
        else if (method!.toLowerCase() !== 'route') continue; // `x.get('/path')`: no handler, not a registration
        // A chain continues from this call: `.route('/z').get(h)` (any handlers) or `.post('/b', h)` (a path and a handler).
        const prefix = comma ? undefined : routePath!;
        while (end > 0) {
            const sticky = prefix === undefined ? NEXT_WITH_PATH : NEXT_ANY;
            sticky.lastIndex = end;
            const next = sticky.exec(code);
            if (!next) break;
            const chained = next[1]!.toLowerCase();
            if (prefix === undefined) found.push({ at: end, entry: entryOf(chained, next[3]!) });
            else found.push({ at: end, entry: entryOf(chained, prefix) });
            end = afterCall(code, end + next[0].lastIndexOf('('));
        }
    }
    const entries = found.sort((a, b) => a.at - b.at).map((f) => f.entry);
    return [...new Set(entries)].slice(0, MAX_ROUTES);
}

/** The `routes` badge value, or undefined when the file registers none. */
export function routesBadge(text: string, path = '', code?: string): string | undefined {
    const routes = scanRoutes(text, path, code);
    return routes.length > 0 ? routes.join(';') : undefined;
}

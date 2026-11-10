/**
 * knowledge/facts/jsEntryPoints.ts — the entry points, `use` registrations and router mounts of a JS/TS file (PRD 41
 * §C5.1, §B5 guard chains), in memory's router model (`UseFact`, `MountFact`, composed by `effectiveGuards`):
 *
 *   - `http-route`: `<router>.<method>('/path', ...middleware, handler)` (Express, Hono, Koa-router style). Its `guards`
 *     are the middleware or wrappers named ON THE REGISTRATION only;
 *   - `uses`: `<router>.use([path,] mw…)` — never folded into the routes; `effectiveGuards` applies each to the routes of
 *     its router registered after it whose path it covers (Hono `use('/x')` is exact; Express `use` is a prefix);
 *   - `mounts`: `<router>.route('/api', sub)` (Hono) and `<router>.use('/api', [mw…,] subRouter)` (Express) where the last
 *     argument is a LOCAL router binding (it registers routes, uses or mounts here, or is built by `new Hono()`,
 *     `express()`, `Router()`) or an imported binding. An Express `use` of an imported binding is a CANDIDATE mount
 *     (`candidateMount`): the resolver makes it a mount when the imported file is a router module (its own facts declare
 *     routes, uses or mounts), else a `use` — never decided by the binding's name;
 *   - `vscode-command`, `webview-message`, `mcp-tool`, `cli-command`, and a Worker's default-export `queue` / `cron`.
 *
 * ORDER: every registration (entry point, use, mount) gets its 0-based index in source order — ONE counter — and its
 * router binding. RAW facts: `chain` holds the import SPECIFIERS of the inline guards, and an imported mount's `target`
 * its specifier; `resolveFileFacts` / the host resolve them against the listing.
 */

import type { EntryPointFact, MountFact, UseFact } from '@seanhogg/builderforce-memory/knowledge';
import { argsOf, calleeText, lastSegment, sortedUnique, stringValue, walk, type FactNode } from './factsAst.js';
import { isFunctionNode } from './jsBody.js';
import { candidateMount, chainImport } from './resolveFacts.js';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'options', 'head']);
const ROUTER_FACTORIES = /^(Hono|OpenAPIHono|express|Router|express\.Router)\(\)$/;

/** Untrusted-input accessors, by the prefix that names them. */
export const INPUT_ACCESSORS: readonly string[] = [
    'c.req.json', 'c.req.param', 'c.req.query', 'c.req.header', 'c.req.formData', 'c.req.parseBody', 'c.req.valid', 'c.req.text',
    'req.body', 'req.query', 'req.params', 'req.headers', 'req.cookies', 'request.json', 'request.body',
    'msg.data', 'message.data', 'event.data', 'process.argv',
];

/** The guard-ish name of a middleware argument: an identifier, or the callee of a factory call (`requireRole('admin')` → `requireRole`). */
function guardName(arg: FactNode): string | undefined {
    if (arg.type === 'identifier') return arg.text;
    if (arg.type === 'member_expression') return calleeText(arg);
    if (arg.type === 'call_expression') return calleeText(arg.childForFieldName('function'));
    return undefined;
}

/** The input accessors read in a handler body. */
function inputsOf(body: FactNode | undefined): string[] {
    if (!body) return [];
    const found: string[] = [];
    walk(body, (n) => {
        if (n.type !== 'member_expression') return;
        const text = calleeText(n);
        const hit = INPUT_ACCESSORS.find((a) => text === a || text.startsWith(`${a}.`));
        if (hit) { found.push(hit); return false; }
    });
    return sortedUnique(found);
}

/** A mount prefix in canonical form: leading `/`, no trailing `/`, `/` for the root. */
const prefixOf = (p: string): string => `/${p.split('/').filter((s) => s !== '').join('/')}`;

interface Ctx {
    bindings: ReadonlyMap<string, string>;
    functions: ReadonlyMap<string, FactNode>;
}

const chainOf = (guards: readonly string[], ctx: Ctx): string[] =>
    sortedUnique(guards.flatMap((g) => { const s = ctx.bindings.get(g.split('.')[0]!); return s !== undefined ? [chainImport(s)] : []; }));

function handlerOf(arg: FactNode | undefined, ctx: Ctx): { symbol: string; body?: FactNode } {
    if (!arg) return { symbol: '' };
    if (arg.type === 'identifier') return { symbol: arg.text, body: ctx.functions.get(arg.text) };
    if (isFunctionNode(arg)) return { symbol: '<inline>', body: arg };
    if (arg.type === 'call_expression') { // a wrapper: handler(...) → the innermost function argument
        const inner = argsOf(arg).find((a) => isFunctionNode(a) || a.type === 'identifier');
        return inner ? handlerOf(inner, ctx) : { symbol: calleeText(arg.childForFieldName('function')) };
    }
    return { symbol: calleeText(arg) };
}

export interface JsRouting {
    entryPoints: EntryPointFact[];
    uses: UseFact[];
    mounts: MountFact[];
}

/** One registration call, before ordering. */
type Registration =
    | { at: number; kind: 'entry'; make: (order: number) => EntryPointFact }
    | { at: number; kind: 'use'; make: (order: number) => UseFact }
    | { at: number; kind: 'mount'; make: (order: number) => MountFact };

export function jsEntryPoints(root: FactNode, bindings: ReadonlyMap<string, string>): JsRouting {
    const functions = new Map<string, FactNode>();
    const routers = new Set<string>();
    const hono = [...bindings.values()].some((s) => s === 'hono' || s.startsWith('hono/') || s === '@hono/zod-openapi');
    walk(root, (n) => {
        if (n.type === 'function_declaration' && n.childForFieldName('name')) functions.set(n.childForFieldName('name')!.text, n);
        if (n.type !== 'variable_declarator') return;
        const name = n.childForFieldName('name')?.text ?? '';
        const value = n.childForFieldName('value');
        if (isFunctionNode(value ?? undefined)) functions.set(name, value!);
        // `new Hono()` and `express()` / `Router()` / `express.Router()` all read as `<Name>()` (calleeText).
        if ((value?.type === 'new_expression' || value?.type === 'call_expression') && ROUTER_FACTORIES.test(calleeText(value))) routers.add(name);
    });
    const ctx: Ctx = { bindings, functions };
    const calls: Array<{ n: FactNode; router: string; method: string; args: FactNode[] }> = [];
    const regs: Registration[] = [];

    walk(root, (n) => {
        if (n.type === 'export_statement' && n.children.some((c) => c.type === 'default')) {
            const value = n.childForFieldName('value');
            for (const m of value?.type === 'object' ? value.namedChildren : []) {
                const name = m.childForFieldName('name')?.text ?? m.childForFieldName('key')?.text;
                const kind = name === 'queue' ? 'queue-consumer' : name === 'scheduled' ? 'cron' : undefined;
                if (kind) regs.push({ at: m.startIndex, kind: 'entry', make: (order) => ({ kind, key: name!, symbol: name!, guards: [], inputs: inputsOf(m), chain: [], order }) });
            }
        }
        if (n.type !== 'call_expression') return;
        const fn = n.childForFieldName('function');
        if (fn?.type !== 'member_expression') return;
        const callee = calleeText(fn);
        const method = lastSegment(callee);
        const router = callee.slice(0, Math.max(0, callee.length - method.length - 1));
        if (!router) return;
        const args = argsOf(n);
        calls.push({ n, router, method, args });
        if (method === 'use' || method === 'route' || (HTTP_METHODS.has(method) && stringValue(args[0])?.startsWith('/'))) routers.add(router);
    });

    /**
     * A mount target: a local router binding by name; an imported binding by its specifier (Hono `route` always mounts),
     * or — for an Express `use(path, …, imported)`, which may be middleware — a CANDIDATE the resolver decides from the
     * imported file's own facts (`candidateMount`).
     */
    const mountTarget = (arg: FactNode | undefined, path: string, candidate: boolean): string | undefined => {
        if (arg?.type !== 'identifier') return undefined;
        if (routers.has(arg.text)) return arg.text;
        const spec = bindings.get(arg.text);
        if (spec === undefined) return undefined;
        return candidate ? candidateMount(spec, arg.text, path) : spec;
    };

    for (const { n, router, method, args } of calls) {
        const first = stringValue(args[0]);
        const entry = (kind: EntryPointFact['kind'], key: string, handler: { symbol: string; body?: FactNode }, guards: string[] = []) =>
            regs.push({ at: n.startIndex, kind: 'entry', make: (order) => {
                const sorted = sortedUnique(guards);
                return { kind, key, symbol: handler.symbol, guards: sorted, inputs: inputsOf(handler.body), chain: chainOf(sorted, ctx), order, router };
            } });
        if (method === 'route' && first?.startsWith('/') && args.length === 2) {
            const target = mountTarget(args[1], first, false);
            if (target !== undefined) regs.push({ at: n.startIndex, kind: 'mount', make: (order) => ({ prefix: prefixOf(first), target, order, router }) });
        } else if (method === 'use') {
            const path = first?.startsWith('/') ? first : undefined;
            const rest = args.slice(path !== undefined ? 1 : 0);
            // Hono mounts only through `route()`: its `use(path, mw)` is always middleware. Express `use` may mount.
            const target = path !== undefined && rest.length > 0 && !hono ? mountTarget(rest[rest.length - 1], path, true) : undefined;
            if (target !== undefined) {
                const guards = sortedUnique(rest.slice(0, -1).map(guardName).filter((g): g is string => !!g));
                regs.push({ at: n.startIndex, kind: 'mount', make: (order) => ({ prefix: prefixOf(path!), target, order, router, ...(guards.length > 0 ? { guards } : {}) }) });
            } else {
                const guards = sortedUnique(rest.map(guardName).filter((g): g is string => !!g));
                const exact = hono && path !== undefined && !path.includes('*');
                regs.push({ at: n.startIndex, kind: 'use', make: (order) => ({ path: path ?? '', guards, order, router, ...(exact ? { match: 'exact' as const } : {}) }) });
            }
        } else if (HTTP_METHODS.has(method) && first?.startsWith('/')) {
            entry('http-route', `${method.toUpperCase()} ${first}`, handlerOf(args[args.length - 1], ctx), args.slice(1, -1).map(guardName).filter((g): g is string => !!g));
        } else if (method === 'registerCommand' && first !== undefined) entry('vscode-command', first, handlerOf(args[1], ctx));
        else if (method === 'onDidReceiveMessage') entry('webview-message', `${router}.onDidReceiveMessage`, handlerOf(args[0], ctx));
        else if ((method === 'tool' || method === 'registerTool') && first !== undefined) entry('mcp-tool', first, handlerOf(args[args.length - 1], ctx));
        else if (method === 'command' && first !== undefined) entry('cli-command', first.split(' ')[0]!, { symbol: first.split(' ')[0]! });
    }

    // ONE registration counter, in source order.
    const out: JsRouting = { entryPoints: [], uses: [], mounts: [] };
    regs.sort((a, b) => a.at - b.at).forEach((r, order) => {
        if (r.kind === 'entry') out.entryPoints.push(r.make(order));
        else if (r.kind === 'use') out.uses.push(r.make(order));
        else out.mounts.push(r.make(order));
    });
    return out;
}

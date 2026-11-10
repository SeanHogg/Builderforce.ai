/**
 * rules/support/routes.ts — the C5.1 entry-point facts of ONE file, by text (WS4 tree-sitter
 * `EntryPointFact`s replace this): route registrations, middleware, and the registry guards on each
 * one's chain WITHIN the file. Computed once per {@link TextView}.
 *
 * Recognized:
 *  - HTTP (Hono, Express-style routers): `<recv>.get|post|put|delete|patch|all|options|head('/path', …)`,
 *    where `<recv>` is an identifier (`app`, `this.router`) OR a call chain (`new Hono().use(g).get(…)`,
 *    `app.use(g).get(…)`). The path must start with `/` and be followed by another argument, so
 *    `map.get('/x')` is not a route.
 *  - Middleware: `<recv>.use([prefix,] …)`, keyed `use <recv> <prefix|*>`.
 *  - `commands.registerCommand('id', …)` (VS Code commands); `onDidReceiveMessage(…)` (webview handlers).
 *
 * A route's guard chain is every registry guard named (as an identifier, never inside a string or a
 * comment) in its call's arguments, plus the guards of every earlier `.use(…)` on the same receiver
 * (the same identifier, or earlier in the same call chain) whose prefix covers the route.
 */

import { escapeRegex, matchClose, matchOpen, type TextView } from './files.js';
import { topLevelArgs } from './statements.js';

export interface RouteFact {
    /** e.g. `POST /api/projects/:id`, `use app /api/*`, `command builderforce.open`, `webview-message #2`. */
    key: string;
    kind: 'http-route' | 'middleware' | 'vscode-command' | 'webview-message';
    offset: number;
    line: number;
    /** Sorted guard names on the chain. */
    guards: string[];
    /** The handler, when the call's last argument is a plain identifier (`h`, `handlers.list`). */
    handler?: string;
    /** Set when the route came from extracted FileFacts (`effectiveGuards`), not the text scan: `offset` is then -1. */
    fromFacts?: boolean;
    /** Guards that apply only because the registration order is unknown (`guardsInferred`): heuristic. */
    guardsInferred?: string[];
    /** Untrusted input accessors the handler uses (facts only; the text path scans the call span). */
    inputs?: string[];
}

const HTTP = /\.\s*(get|post|put|delete|patch|all|options|head)\s*\(\s*(['"`])(\/[^'"`\n]*)\2\s*,/g;
const USE = /\.\s*use\s*\(/g;
const USE_PATH = /^\(\s*(['"`])([^'"`\n]*)\1/;
const COMMAND = /\bcommands\s*\.\s*registerCommand\s*\(\s*(['"`])([^'"`\n]+)\1/g;
const WEBVIEW = /\bonDidReceiveMessage\s*\(/g;
const IDENT_BACK = /[\w$]/;

interface Receiver {
    /** Stable text label: `app`, `this.router`, `new Hono`, `createApp()`. */
    label: string;
    /** Which `.use` calls apply: the label for a named receiver, the chain start for an anonymous one. */
    scope: string;
}

function skipBack(s: string, i: number): number { while (i >= 0 && /\s/.test(s[i]!)) i--; return i; }

/** The identifier ending at `end` (inclusive) and its start. */
function identBack(s: string, end: number): { name: string; start: number } | undefined {
    let i = end;
    while (i >= 0 && IDENT_BACK.test(s[i]!)) i--;
    return i === end ? undefined : { name: s.slice(i + 1, end + 1), start: i + 1 };
}

/** Walks back from the `.` before a method call to the chain's root receiver. */
export function receiverOf(bare: string, dot: number): Receiver {
    let i = skipBack(bare, dot - 1);
    const names: string[] = [];
    for (let guard = 0; guard < 256 && i >= 0; guard++) {
        if (bare[i] === ')') {
            const open = matchOpen(bare, i);
            if (open < 0) break;
            const callee = identBack(bare, skipBack(bare, open - 1));
            if (!callee) return { label: 'chain', scope: `chain@${open}` };
            i = skipBack(bare, callee.start - 1);
            if (bare[i] === '.') { i = skipBack(bare, i - 1); continue; }
            const kw = identBack(bare, i);
            if (kw?.name === 'new') return { label: `new ${callee.name}`, scope: `chain@${kw.start}` };
            return { label: `${callee.name}()`, scope: `chain@${callee.start}` };
        }
        const id = identBack(bare, i);
        if (!id) break;
        names.unshift(id.name);
        i = skipBack(bare, id.start - 1);
        if (bare[i] === '.') { i = skipBack(bare, i - 1); if (bare[i] === ')') break; continue; }
        return { label: names.join('.'), scope: names.join('.') };
    }
    const label = names.length > 0 ? names.join('.') : 'chain';
    return { label, scope: `${label}@${Math.max(0, i)}` };
}

/** `/api/*` and `/api/` cover `/api/x`; an absent path covers every route. */
function covers(prefix: string | undefined, path: string): boolean {
    if (prefix === undefined || prefix === '' || prefix === '*' || prefix === '/*') return true;
    const p = prefix.replace(/\/?\*$/, '');
    return path === p || path.startsWith(p.endsWith('/') ? p : `${p}/`);
}

/** The last top-level argument of the call spanning `(open, close)`, when it is a plain (dotted) identifier. */
function handlerOf(code: string, bare: string, open: number, close: number): string | undefined {
    const args = topLevelArgs(bare, open, close);
    const span = args[args.length - 1];
    // A trailing comma leaves an empty last argument: no handler.
    if (!span || bare.slice(span[1], close).includes(',')) return undefined;
    const last = code.slice(span[0], span[1]).trim();
    return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(last) ? last : undefined;
}

export function routesOf(view: TextView, guardRanks: Readonly<Record<string, number>>): RouteFact[] {
    const names = Object.keys(guardRanks).sort();
    return view.memo(`routes\u0000${names.join(',')}`, () => compute(view, names));
}

function compute(view: TextView, guardNames: readonly string[]): RouteFact[] {
    const { code, bare } = view;
    const guardRe = guardNames.length > 0 ? new RegExp(`(?<![\\w$])(?:${guardNames.map(escapeRegex).join('|')})(?![\\w$])`, 'g') : undefined;
    const guardsIn = (from: number, to: number): string[] =>
        guardRe ? [...new Set([...bare.slice(from, to).matchAll(guardRe)].map((m) => m[0]))].sort() : [];
    const span = (open: number): [number, number] | undefined => { const c = matchClose(bare, open); return c < 0 ? undefined : [open, c]; };

    const facts: RouteFact[] = [];
    const counts = new Map<string, number>();
    const keyed = (key: string) => {
        const n = (counts.get(key) ?? 0) + 1;
        counts.set(key, n);
        return n === 1 ? key : `${key} #${n}`;
    };

    const uses: Array<{ scope: string; offset: number; prefix?: string; guards: string[] }> = [];
    for (const m of bare.matchAll(USE)) {
        const s = span(m.index + m[0].length - 1);
        if (!s) continue;
        const recv = receiverOf(bare, m.index);
        const prefix = USE_PATH.exec(code.slice(s[0], s[1]))?.[2];
        const guards = guardsIn(s[0], s[1]);
        uses.push({ scope: recv.scope, offset: m.index, ...(prefix !== undefined ? { prefix } : {}), guards });
        facts.push({ key: `use ${recv.label} ${prefix ?? '*'}`, kind: 'middleware', offset: m.index, line: view.lineAt(m.index), guards });
    }

    for (const m of code.matchAll(HTTP)) {
        if (bare[m.index] !== code[m.index]) continue; // inside a string or comment
        const s = span(m.index + m[0].indexOf('('));
        if (!s) continue;
        const recv = receiverOf(bare, m.index);
        const routePath = m[3]!;
        const inherited = uses.filter((u) => u.scope === recv.scope && u.offset < m.index && covers(u.prefix, routePath)).flatMap((u) => u.guards);
        const handler = handlerOf(code, bare, s[0], s[1]);
        facts.push({
            key: `${m[1]!.toUpperCase()} ${routePath}`, kind: 'http-route', offset: m.index, line: view.lineAt(m.index),
            guards: [...new Set([...guardsIn(s[0], s[1]), ...inherited])].sort(), ...(handler ? { handler } : {}),
        });
    }

    for (const m of code.matchAll(COMMAND)) {
        if (bare[m.index] !== code[m.index]) continue;
        const s = span(m.index + m[0].indexOf('('));
        facts.push({ key: `command ${m[2]!}`, kind: 'vscode-command', offset: m.index, line: view.lineAt(m.index), guards: s ? guardsIn(s[0], s[1]) : [] });
    }

    for (const m of bare.matchAll(WEBVIEW)) {
        const s = span(m.index + m[0].length - 1);
        facts.push({ key: 'webview-message', kind: 'webview-message', offset: m.index, line: view.lineAt(m.index), guards: s ? guardsIn(s[0], s[1]) : [] });
    }

    return facts.sort((a, b) => a.offset - b.offset).map((f) => ({ ...f, key: keyed(f.key) }));
}

/** The strongest rank among `guards` (0 for none). */
export function maxRank(guards: readonly string[], ranks: Readonly<Record<string, number>>): number {
    return guards.reduce((m, g) => Math.max(m, ranks[g] ?? 0), 0);
}

/** The strongest guard (rank, then name), if any. */
export function strongest(guards: readonly string[], ranks: Readonly<Record<string, number>>): string | undefined {
    return [...guards].sort((a, b) => (ranks[b] ?? 0) - (ranks[a] ?? 0) || (a < b ? -1 : a > b ? 1 : 0))[0];
}

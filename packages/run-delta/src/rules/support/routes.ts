/**
 * rules/support/routes.ts — the C5.1 entry-point facts of ONE file, by text (WS4 tree-sitter
 * `EntryPointFact`s replace this): route registrations and the registry guards on each one's chain
 * WITHIN the file.
 *
 * Recognized registrations:
 *  - HTTP (Hono, Express-style routers): `<recv>.get|post|put|delete|patch|all|options|head('/path', …)`.
 *    The path must start with `/` and be followed by another argument, so `map.get('/x')` is not a route.
 *  - `commands.registerCommand('id', …)` (VS Code commands).
 *  - `onDidReceiveMessage(…)` (webview message handlers; keyed by ordinal).
 *
 * A route's guard chain is every registry guard named (as an identifier, never inside a string or a
 * comment) in its call's arguments — inline middleware and the handler body — plus the guards of any
 * earlier `<recv>.use(…)` on the same receiver whose path prefix covers the route.
 */

import { lineAt } from '../../engine/text.js';
import { masked, matchClose } from './files.js';

export interface RouteFact {
    /** e.g. `POST /api/projects/:id`, `command builderforce.open`, `webview-message #1`. */
    key: string;
    kind: 'http-route' | 'vscode-command' | 'webview-message';
    offset: number;
    line: number;
    /** Sorted guard names on the chain. */
    guards: string[];
}

const HTTP = /\b([A-Za-z_$][\w$]*)\s*\.\s*(get|post|put|delete|patch|all|options|head)\s*\(\s*(['"`])(\/[^'"`\n]*)\3\s*,/g;
const USE = /\b([A-Za-z_$][\w$]*)\s*\.\s*use\s*\(/g;
const USE_PATH = /^\(\s*(['"`])([^'"`\n]*)\1/;
const COMMAND = /\bcommands\s*\.\s*registerCommand\s*\(\s*(['"`])([^'"`\n]+)\1/g;
const WEBVIEW = /\bonDidReceiveMessage\s*\(/g;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function guardsIn(bare: string, from: number, to: number, guardNames: readonly string[]): string[] {
    const span = bare.slice(from, to);
    return guardNames.filter((g) => new RegExp(`(?<![\\w$])${escapeRe(g)}(?![\\w$])`).test(span));
}

/** The call's argument span `[open, close]` for the `(` at or after `from`. */
function callSpan(code: string, bare: string, from: number): [number, number] | undefined {
    const open = code.indexOf('(', from);
    if (open < 0) return undefined;
    const close = matchClose(bare, open);
    return close < 0 ? undefined : [open, close];
}

/** `/api/*` and `/api/` cover `/api/x`; an absent path covers every route. */
function covers(prefix: string | undefined, path: string): boolean {
    if (prefix === undefined || prefix === '' || prefix === '*' || prefix === '/*') return true;
    const p = prefix.replace(/\/?\*$/, '');
    return path === p || path.startsWith(p.endsWith('/') ? p : `${p}/`);
}

export function routesOf(text: string, path: string, guardRanks: Readonly<Record<string, number>>): RouteFact[] {
    const { code, bare } = masked(text, path);
    const guardNames = Object.keys(guardRanks).sort();
    const facts: RouteFact[] = [];
    const counts = new Map<string, number>();
    const keyed = (key: string) => {
        const n = (counts.get(key) ?? 0) + 1;
        counts.set(key, n);
        return n === 1 ? key : `${key} #${n}`;
    };

    const uses: Array<{ recv: string; offset: number; prefix?: string; guards: string[] }> = [];
    for (let m = USE.exec(bare); m; m = USE.exec(bare)) {
        const span = callSpan(code, bare, m.index + m[0].length - 1);
        if (!span) continue;
        const prefix = USE_PATH.exec(code.slice(span[0], span[1]))?.[2];
        uses.push({ recv: m[1]!, offset: m.index, ...(prefix !== undefined ? { prefix } : {}), guards: guardsIn(bare, span[0], span[1], guardNames) });
    }
    USE.lastIndex = 0;

    for (let m = HTTP.exec(code); m; m = HTTP.exec(code)) {
        if (bare[m.index] !== code[m.index]) continue; // inside a string or comment
        const span = callSpan(code, bare, m.index + m[0].indexOf('('));
        if (!span) continue;
        const [recv, method, , routePath] = [m[1]!, m[2]!, m[3], m[4]!];
        const own = guardsIn(bare, span[0], span[1], guardNames);
        const inherited = uses.filter((u) => u.recv === recv && u.offset < m!.index && covers(u.prefix, routePath)).flatMap((u) => u.guards);
        facts.push({
            key: keyed(`${method.toUpperCase()} ${routePath}`), kind: 'http-route', offset: m.index, line: lineAt(text, m.index),
            guards: [...new Set([...own, ...inherited])].sort(),
        });
    }
    HTTP.lastIndex = 0;

    for (let m = COMMAND.exec(code); m; m = COMMAND.exec(code)) {
        if (bare[m.index] !== code[m.index]) continue;
        const span = callSpan(code, bare, m.index + m[0].indexOf('('));
        facts.push({
            key: keyed(`command ${m[2]!}`), kind: 'vscode-command', offset: m.index, line: lineAt(text, m.index),
            guards: span ? guardsIn(bare, span[0], span[1], guardNames) : [],
        });
    }
    COMMAND.lastIndex = 0;

    for (let m = WEBVIEW.exec(bare); m; m = WEBVIEW.exec(bare)) {
        const span = callSpan(code, bare, m.index + m[0].length - 1);
        facts.push({
            key: keyed('webview-message'), kind: 'webview-message', offset: m.index, line: lineAt(text, m.index),
            guards: span ? guardsIn(bare, span[0], span[1], guardNames) : [],
        });
    }
    WEBVIEW.lastIndex = 0;

    return facts.sort((a, b) => a.offset - b.offset);
}

/** The strongest rank among `guards` (0 for none). */
export function maxRank(guards: readonly string[], ranks: Readonly<Record<string, number>>): number {
    return guards.reduce((m, g) => Math.max(m, ranks[g] ?? 0), 0);
}

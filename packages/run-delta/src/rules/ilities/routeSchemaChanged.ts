/**
 * rules/ilities/routeSchemaChanged.ts — `route-schema-changed` (ilities.compatibility, warn; C7 wire
 * contracts): an HTTP route present on both sides whose request validation changed — a validator added,
 * removed or retargeted (`zValidator('json', S)`, Hono `validator(…)`, `sValidator`, `vValidator`,
 * `tbValidator`), or the same-file declaration of a schema it names (`const S = z.object(…)`) edited.
 * Routes come from the shared C5.1 route facts ({@link routesOf}); one finding per route key.
 *
 * Heuristic: text-level, same-file schemas only; WS4 schema facts replace it.
 */

import type { DeltaRule, RuleFinding } from '../../contract.js';
import { filePairs, isJsPath, isTestPath, matchClose, redact, squash, type TextView } from '../support/files.js';
import { heuristicFinding, ruleIdentity } from '../support/identity.js';
import { routesOf } from '../support/routes.js';
import { declarationsOf, topLevelArgs } from '../support/statements.js';

/** A route argument that is a validator call: `zValidator('json', S)`, group 1 = quote, 2 = target. */
const VALIDATOR = /^\s*(?:zValidator|validator|sValidator|vValidator|tbValidator)\s*\(\s*(['"])(\w+)\1\s*,/;

/** Route key → its normalized request contract (validator targets with their schema text). */
function contracts(view: TextView, guards: Readonly<Record<string, number>>): Map<string, string> {
    const { bare, code } = view;
    // Built only when a route actually names a validator (most files have none).
    let decls: ReturnType<typeof declarationsOf> | undefined;
    const out = new Map<string, string>();
    for (const r of routesOf(view, guards)) {
        if (r.kind !== 'http-route') continue;
        const open = bare.indexOf('(', r.offset);
        const close = open < 0 ? -1 : matchClose(bare, open);
        if (close < 0) continue;
        const parts: string[] = [];
        for (const [from, to] of topLevelArgs(bare, open, close)) {
            const m = VALIDATOR.exec(code.slice(from, to));
            if (!m) continue;
            const vOpen = bare.indexOf('(', from), vClose = matchClose(bare, vOpen);
            const schemaArg = vClose < 0 ? undefined : topLevelArgs(bare, vOpen, vClose)[1];
            if (!schemaArg) continue;
            const schema = squash(code.slice(schemaArg[0], schemaArg[1]));
            const decl = /^[A-Za-z_$][\w$]*$/.test(schema) ? (decls ??= declarationsOf(view)).get(schema) : undefined;
            parts.push(`${m[2]}:${schema}${decl ? `=${squash(code.slice(decl[0], decl[1]))}` : ''}`);
        }
        out.set(r.key, parts.sort().join(' | '));
    }
    return out;
}

export const routeSchemaChanged: DeltaRule = {
    id: 'route-schema-changed',
    version: 1,
    dimension: 'ilities.compatibility',
    reads: ['content'],
    derive(input) {
        const after: RuleFinding[] = [];
        for (const p of filePairs(input)) {
            if (!p.before || !p.after || !isJsPath(p.path) || isTestPath(p.path)) continue;
            const b = contracts(p.before, input.registries.guards), a = contracts(p.after, input.registries.guards);
            for (const [route, contract] of [...a].sort(([x], [y]) => (x < y ? -1 : 1))) {
                const was = b.get(route);
                if (was === undefined || was === contract) continue;
                after.push(heuristicFinding(
                    ruleIdentity(routeSchemaChanged, 'route', route, { members: [p.path], snippet: redact(contract) }),
                    'warn',
                    { route, file: p.path },
                    [
                        { side: 'before', path: p.before.sidePath, note: redact(was || '-').slice(0, 200) },
                        { side: 'after', path: p.after.sidePath, note: redact(contract || '-').slice(0, 200) },
                    ],
                ));
            }
        }
        return { before: [], after };
    },
};

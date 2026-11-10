/**
 * rules/support/routeDelta.ts — how each changed file's entry points and guard chains moved (C5.1),
 * computed ONCE per rule input and shared by `guard-removed`, `guard-weakened`, `entry-added` and
 * `entry-removed`. By registry rank:
 *
 *  - `chain`: a route or middleware present on both sides lost a guard. Still covered by an equal-or-
 *    stronger guard: nothing; weaker guards left: weakened; nothing left: removed.
 *  - `middleware`: a `.use(…)` that carried guards is gone: each of its guards is removed.
 *  - `rekeyed`: a route vanished and a route with the SAME handler symbol appeared without the guard
 *    the old one had: removed (not entry-removed + entry-added).
 *  - `unguarded-sibling`: a NEW unguarded route in a file whose surviving sibling routes are all guarded:
 *    removed (the strongest sibling guard is the one missing), not a plain entry-added.
 *
 *  - `widened`: a NEW HTTP method on a path the before side already served: `method-widened`, not
 *    entry-added (a path gaining `ALL` or `POST` widens what an existing endpoint accepts).
 *
 * Everything else that appeared or vanished is an entry added / removed.
 */

import type { RuleInput } from '../../contract.js';
import { filePairs, isCodePath, perInput } from './files.js';
import { pairRoutes } from './factRoutes.js';
import { maxRank, strongest, type RouteFact } from './routes.js';

export interface SideRef { path: string; line: number; key: string }

export interface GuardChange {
    path: string;
    /** The route or middleware key the finding anchors on (after side when one exists). */
    key: string;
    kind: 'removed' | 'weakened';
    guard: string;
    replacement?: string;
    via: 'chain' | 'middleware' | 'rekeyed' | 'unguarded-sibling';
    before?: SideRef;
    after?: SideRef;
    /** `measured` when both sides' chains came from comparable FileFacts and no guard was inferred. */
    confidence?: 'measured' | 'heuristic';
}

export interface EntryChange {
    path: string;
    sidePath: string;
    route: RouteFact;
}

export interface RouteDelta {
    guards: GuardChange[];
    added: EntryChange[];
    removed: EntryChange[];
    /** New HTTP methods on a path the before side already served (`method-widened`, never also `entry-added`). */
    widened: Array<EntryChange & { from: string[] }>;
}

/** `GET /api/x #2` → `GET`, `/api/x`. */
const methodAndPath = (key: string): [string, string] => { const [m = '', p = ''] = key.split(' '); return [m, p]; };

const ref = (path: string, r: RouteFact): SideRef => ({ path, line: r.line, key: r.key });

export function routeDelta(input: RuleInput): RouteDelta {
    return perInput(input, 'routeDelta', () => {
        const ranks = input.registries.guards;
        const out: RouteDelta = { guards: [], added: [], removed: [], widened: [] };
        for (const pair of filePairs(input)) {
            if (!isCodePath(pair.path)) continue;
            const { before: bList, after: aList, fromFacts } = pairRoutes(input, pair);
            const b = new Map(bList.map((r) => [r.key, r])), a = new Map(aList.map((r) => [r.key, r]));
            const firstChange = out.guards.length;
            const bPath = pair.before?.sidePath ?? pair.path, aPath = pair.after?.sidePath ?? pair.path;

            // Same key on both sides: the chain lost a guard.
            for (const [key, after] of a) {
                const prev = b.get(key);
                if (!prev) continue;
                const left = new Set(after.guards);
                for (const guard of prev.guards) {
                    if (left.has(guard)) continue;
                    if (after.guards.length > 0 && maxRank(after.guards, ranks) >= (ranks[guard] ?? 0)) continue;
                    const replacement = strongest(after.guards, ranks);
                    out.guards.push({
                        path: pair.path, key, guard, via: 'chain', before: ref(bPath, prev), after: ref(aPath, after),
                        ...(replacement ? { kind: 'weakened' as const, replacement } : { kind: 'removed' as const }),
                    });
                }
            }

            // Middleware that carried guards is gone.
            for (const [key, prev] of b) {
                if (prev.kind !== 'middleware' || a.has(key)) continue;
                for (const guard of prev.guards) out.guards.push({ path: pair.path, key, guard, kind: 'removed', via: 'middleware', before: ref(bPath, prev) });
            }

            const goneRoutes = [...b.values()].filter((r) => r.kind !== 'middleware' && !a.has(r.key));
            const newRoutes = [...a.values()].filter((r) => r.kind !== 'middleware' && !b.has(r.key));

            // Rekeyed: same handler symbol, the guard dropped on the way.
            const consumedGone = new Set<RouteFact>(), consumedNew = new Set<RouteFact>();
            for (const cur of newRoutes) {
                if (!cur.handler) continue;
                const old = goneRoutes.find((r) => !consumedGone.has(r) && r.handler === cur.handler && r.guards.length > 0);
                if (!old) continue;
                const lost = old.guards.filter((g) => !cur.guards.includes(g) && maxRank(cur.guards, ranks) < (ranks[g] ?? 0));
                if (lost.length === 0) continue;
                consumedGone.add(old);
                consumedNew.add(cur);
                for (const guard of lost) {
                    const replacement = strongest(cur.guards, ranks);
                    out.guards.push({
                        path: pair.path, key: cur.key, guard, via: 'rekeyed', before: ref(bPath, old), after: ref(aPath, cur),
                        ...(replacement ? { kind: 'weakened' as const, replacement } : { kind: 'removed' as const }),
                    });
                }
            }

            // A new unguarded route among routes that are all guarded.
            const siblings = [...a.values()].filter((r) => r.kind === 'http-route' && b.has(r.key));
            const siblingGuard = siblings.length > 0 && siblings.every((r) => r.guards.length > 0)
                ? strongest(siblings.flatMap((r) => r.guards), ranks) : undefined;
            for (const cur of newRoutes) {
                if (consumedNew.has(cur) || cur.kind !== 'http-route' || cur.guards.length > 0 || !siblingGuard) continue;
                consumedNew.add(cur);
                out.guards.push({ path: pair.path, key: cur.key, guard: siblingGuard, kind: 'removed', via: 'unguarded-sibling', after: ref(aPath, cur) });
            }

            // C5.1: a change read from comparable facts is MEASURED, unless the guard was only inferred (unknown
            // registration order) on either side, or the change is the unguarded-sibling inference itself.
            for (let i = firstChange; i < out.guards.length; i++) {
                const c = out.guards[i]!;
                const inferred = [c.before && b.get(c.before.key), c.after && a.get(c.after.key)].some((r) => r && r.guardsInferred?.includes(c.guard));
                out.guards[i] = { ...c, confidence: fromFacts && !inferred && c.via !== 'unguarded-sibling' ? 'measured' : 'heuristic' };
            }

            // A new method on a path the before side served (`GET /x` → `ALL /x`, or `POST /x` beside it).
            const methodsByPath = new Map<string, Set<string>>();
            for (const r of bList) {
                if (r.kind !== 'http-route') continue;
                const [m, p] = methodAndPath(r.key);
                (methodsByPath.get(p) ?? methodsByPath.set(p, new Set()).get(p)!).add(m);
            }
            for (const r of newRoutes) {
                if (consumedNew.has(r) || !pair.after || r.kind !== 'http-route') continue;
                const [m, p] = methodAndPath(r.key);
                const had = methodsByPath.get(p);
                if (!had || had.has(m)) continue;
                consumedNew.add(r);
                out.widened.push({ path: pair.path, sidePath: aPath, route: r, from: [...had].sort() });
            }

            for (const r of newRoutes) if (!consumedNew.has(r) && pair.after) out.added.push({ path: pair.path, sidePath: aPath, route: r });
            for (const r of goneRoutes) if (!consumedGone.has(r) && pair.before) out.removed.push({ path: pair.path, sidePath: bPath, route: r });
        }
        return out;
    });
}

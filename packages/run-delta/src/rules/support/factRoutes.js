/**
 * rules/support/factRoutes.ts — ONE place the C5.1 route rules get a changed file's entry points on both
 * sides: from extracted FileFacts when the host supplied comparable facts for the file on BOTH sides
 * (`comparableFacts`: same extractor and facts version; C9 never mixes them), read through memory's
 * `effectiveGuards` (`entryPointsOf`: prior `use`s by registration order, mounting routers' guards,
 * prefix-joined mounted keys); otherwise from the text scan (`routesOf`). Memoized per rule input and file.
 *
 * A facts route keeps only REGISTRY guards (which names are guards is registry data), carries its
 * `guardsInferred` (registration order unknown, so heuristic), its untrusted `inputs`, and the handler
 * symbol; its line is located in the side's text when the path or symbol appears there (else 1).
 */
import { comparableFacts, entryPointsThrough } from './fileFacts.js';
import { perInput } from './files.js';
import { routesOf } from './routes.js';
const KINDS = new Set(['http-route', 'vscode-command', 'webview-message']);
function lineOf(view, ep) {
    if (!view)
        return 1;
    const path = ep.key.split(' ')[1];
    const tail = path ? path.slice(path.lastIndexOf('/')) : undefined;
    for (const needle of [path, tail && tail.length > 1 ? tail : undefined, ep.symbol.split('.').pop()]) {
        if (!needle)
            continue;
        const at = view.text.indexOf(needle);
        if (at >= 0)
            return view.lineAt(at);
    }
    return 1;
}
function factRoutes(view, eps, ranks) {
    const counts = new Map();
    const out = [];
    for (const ep of eps) {
        if (!KINDS.has(ep.kind))
            continue;
        const n = (counts.get(ep.key) ?? 0) + 1;
        counts.set(ep.key, n);
        const isGuard = (g) => ranks[g] !== undefined;
        out.push({
            key: n === 1 ? ep.key : `${ep.key} #${n}`,
            kind: ep.kind,
            offset: -1,
            line: lineOf(view, ep),
            guards: [...new Set(ep.guards.filter(isGuard))].sort(),
            ...(ep.symbol ? { handler: ep.symbol } : {}),
            fromFacts: true,
            guardsInferred: ep.guardsInferred.filter(isGuard),
            inputs: [...ep.inputs],
        });
    }
    return out;
}
/** A changed file's routes on both sides: facts when comparable on both, else text. */
export function pairRoutes(input, pair) {
    return perInput(input, `pairRoutes\u0000${pair.path}`, () => {
        const ranks = input.registries.guards;
        if (pair.before && pair.after && comparableFacts(input, pair.path)) {
            // Through the file: its own routes AND those mounted beneath it (a removed `use` before a mount).
            const b = entryPointsThrough(input, 'before', pair.path), a = entryPointsThrough(input, 'after', pair.path);
            if (b && a)
                return { before: factRoutes(pair.before, b, ranks), after: factRoutes(pair.after, a, ranks), fromFacts: true };
        }
        return {
            before: pair.before ? routesOf(pair.before, ranks) : [],
            after: pair.after ? routesOf(pair.after, ranks) : [],
            fromFacts: false,
        };
    });
}
//# sourceMappingURL=factRoutes.js.map
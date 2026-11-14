/**
 * rules/support/routeInputs.ts — what one entry point reads and what covers it:
 *
 *  - {@link routeInputs}: the registry taint SOURCES it uses, as sorted `{ kind, entry }` pairs: from the
 *    facts route's `inputs` (WS4 `EntryPointFact.inputs`, which follow a handler passed by name), or else
 *    from the text route's registration call span (a handler passed by name reads as no inputs);
 *  - {@link routeCoverage}: the STRIDE coverage names on its chain (its guards, plus identifiers in the call
 *    span on the text path).
 */
import { callSpanAt, liveText } from './taint.js';
function spanText(view, route) {
    if (route.offset < 0)
        return '';
    const live = liveText(view);
    const span = callSpanAt(live, route.offset);
    return span ? live.slice(span[0], span[1] + 1) : '';
}
export function routeInputs(view, route, reg) {
    const seen = new Map();
    // A facts accessor is written bare (`c.req.json`); the call form lets a `name(` source entry match it.
    const texts = route.inputs ? route.inputs.map((i) => `${i}()`) : [spanText(view, route)];
    for (const text of texts) {
        for (const h of reg.sources.scan(text))
            seen.set(`${h.key}\u0000${h.entry}`, { kind: h.key, entry: h.entry });
    }
    return [...seen.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, v]) => v);
}
export function routeCoverage(view, route, coverage) {
    const names = coverage.namesInText(spanText(view, route));
    for (const g of route.guards)
        names.add(g);
    return names;
}
//# sourceMappingURL=routeInputs.js.map
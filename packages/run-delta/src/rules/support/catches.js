/**
 * rules/support/catches.ts — the error handlers of one JS/TS file, by text over masked source (WS4
 * tree-sitter body facts replace this): every `catch` clause and every `.catch(…)` handler, with the
 * caught binding and the body span. Shared by `catch-swallowed`, `error-handling-removed` (C7
 * reliability) and `catch-all-added` (C8.2). Computed once per {@link TextView}.
 *
 * A `.catch(…)` whose argument is not a function literal (`.catch(reportError)`, `.catch(next)`,
 * `.catch(console.error)`) FORWARDS the error: `forwards` is set and it is never a catch-all.
 */
import { matchClose } from './files.js';
import { glued } from './statements.js';
// Literal-led (no leading lookbehind); the preceding char is checked with `glued`.
const CLAUSE = /catch\s*(?:\(\s*([^)]*?)\s*\))?\s*\{/g;
const HANDLER = /\.\s*catch\s*\(/g;
/** `(e) =>`, `e =>`, `async (e) =>`, `function (e)`, `async function name(e)`; group 1 = the parameter list text. */
const FUNCTION_LITERAL = /^\s*(?:async\s+)?(?:\(([^()]*)\)\s*(?::[^=]*)?=>|([A-Za-z_$][\w$]*)\s*=>|function\b\s*\*?\s*[\w$]*\s*\(([^()]*)\))/;
function parseParam(raw) {
    const p = raw.trim();
    if (/^[{[]/.test(p))
        return { binding: '', destructured: true };
    return { binding: /^[A-Za-z_$][\w$]*/.exec(p)?.[0] ?? '', destructured: false };
}
function compute(view) {
    const bare = view.bare;
    const out = [];
    for (const m of bare.matchAll(CLAUSE)) {
        if (glued(bare, m.index))
            continue;
        const open = m.index + m[0].length - 1;
        const close = matchClose(bare, open);
        if (close < 0)
            continue;
        out.push({ kind: 'clause', offset: m.index, length: m[0].length - 1, ...parseParam((m[1] ?? '').replace(/:[\s\S]*$/, '')), forwards: false, from: open + 1, to: close });
    }
    for (const m of bare.matchAll(HANDLER)) {
        const open = m.index + m[0].length - 1;
        const close = matchClose(bare, open);
        if (close < 0)
            continue;
        const args = bare.slice(open + 1, close);
        const fn = FUNCTION_LITERAL.exec(args);
        const param = fn ? parseParam(fn[1] ?? fn[2] ?? fn[3] ?? '') : { binding: '', destructured: false };
        out.push({ kind: 'handler', offset: m.index, length: m[0].length, ...param, forwards: !fn && args.trim() !== '', from: open + 1, to: close });
    }
    return out.sort((a, b) => a.offset - b.offset);
}
export function catchesOf(view) {
    return view.memo('catches', () => compute(view));
}
/** The body of a site in the masked text. */
export const bodyOf = (view, site) => view.bare.slice(site.from, site.to);
/** Whether the handler rethrows or re-rejects. */
export const rethrows = (body) => /(?<![\w$])throw\b|Promise\s*\.\s*reject\s*\(/.test(body);
/** Whether a handler never looks at the caught error: no binding (or `_`-named, or unused) and not forwarding or destructuring it. */
export function ignoresError(view, site) {
    if (site.forwards || site.destructured)
        return false;
    if (site.binding === '' || site.binding.startsWith('_'))
        return true;
    const body = bodyOf(view, site);
    const uses = [...body.matchAll(new RegExp(`(?<![\\w$.])${site.binding.replace(/\$/g, '\\$')}(?![\\w$])`, 'g'))].length;
    // A handler's own parameter declaration sits inside its argument span.
    return uses <= (site.kind === 'handler' ? 1 : 0);
}
//# sourceMappingURL=catches.js.map
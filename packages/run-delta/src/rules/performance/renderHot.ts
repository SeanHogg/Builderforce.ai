/**
 * rules/performance/renderHot.ts — `render-hot` (performance, warn; C6.1, frontend): React render
 * hazards in a changed `.tsx` / `.jsx` file, by key:
 *
 *  - `inline-prop:<attr>`: a COMPONENT (capitalized tag) rendered inside a `.map(` callback gets a fresh
 *    object, array or function literal as a prop (`style={{…}}`, `onClick={() => …}`), so every item's
 *    memoization breaks (a DOM element has none to break, so `<li onClick={…}>` is not reported);
 *  - `missing-key:<Tag>`: the element a `.map(` callback returns has no `key` (`React.Children.map` keys
 *    its children itself and is not reported);
 *  - `effect-without-deps`: `useEffect` / `useLayoutEffect` with no dependency array (runs every render).
 *
 * The tags inside a callback come from a binary search over the offset-sorted tags, never a full scan per
 * callback.
 *
 * Heuristic: text-level JSX; WS4 tree-sitter JSX facts replace it.
 */

import type { DeltaRule } from '../../contract.js';
import { isTestPath, matchClose, type TextView } from '../support/files.js';
import { hasAttr, inlineAttrs, isJsxPath, jsxTags, type JsxTag } from '../support/jsx.js';
import { loopsOf } from '../support/loops.js';
import { stateSides, type Hit } from '../support/stateRule.js';
import { topLevelArgs } from '../support/statements.js';

const EFFECT = /(useEffect|useLayoutEffect)\s*\(/g;
const CHILDREN_MAP = /Children\s*\.\s*(?:map|flatMap)\s*\($/;

/** Index of the first tag whose offset is ≥ `at` (tags are offset-sorted). */
function firstAtOrAfter(tags: readonly JsxTag[], at: number): number {
    let lo = 0, hi = tags.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (tags[m]!.offset < at) lo = m + 1; else hi = m; }
    return lo;
}

function hitsOf(view: TextView): Hit[] {
    const { bare } = view;
    const hits: Hit[] = [];
    const tags = jsxTags(view);
    for (const span of loopsOf(view)) {
        if (span.kind !== 'map' && span.kind !== 'flatMap') continue;
        const inside: JsxTag[] = [];
        for (let i = firstAtOrAfter(tags, span.from); i < tags.length && tags[i]!.offset < span.to; i++) if (tags[i]!.end <= span.to) inside.push(tags[i]!);
        if (inside.length === 0) continue;
        // The callback's outermost element (a keyed `<Fragment key>` counts as keyed).
        const first = inside[0]!;
        if (!first.spread && !hasAttr(first, 'key') && !CHILDREN_MAP.test(bare.slice(Math.max(0, span.from - 40), span.from))) {
            hits.push({ offset: first.offset, length: first.name.length + 1, key: `missing-key:${first.name}` });
        }
        for (const tag of inside) {
            if (!/^[A-Z]/.test(tag.name)) continue;
            for (const attr of inlineAttrs(tag)) hits.push({ offset: tag.offset, length: tag.end - tag.offset, key: `inline-prop:${attr}` });
        }
    }
    for (const m of bare.matchAll(EFFECT)) {
        if (/[\w$]/.test(bare[m.index - 1] ?? '')) continue;
        const open = m.index + m[0].length - 1;
        const close = matchClose(bare, open);
        if (close < 0 || topLevelArgs(bare, open, close).length >= 2) continue;
        hits.push({ offset: m.index, length: m[0].length, key: 'effect-without-deps', params: { call: m[1]! } });
    }
    return hits;
}

export const renderHot: DeltaRule = {
    id: 'render-hot',
    version: 2,
    dimension: 'performance',
    reads: ['content'],
    derive(input) {
        return stateSides(renderHot, { files: (p) => isJsxPath(p) && !isTestPath(p), hits: hitsOf, severity: 'warn' }, input);
    },
};

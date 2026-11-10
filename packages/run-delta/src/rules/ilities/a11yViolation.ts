/**
 * rules/ilities/a11yViolation.ts — `a11y-violation` (ilities.interaction-capability, warn; C7
 * accessibility lint on changed components), by key, in a changed `.tsx` / `.jsx` file:
 *
 *  - `img-alt`: `<img>` without `alt`;
 *  - `input-label`: `<input>` / `<select>` / `<textarea>` (not `type="hidden"`) with no `aria-label`,
 *    `aria-labelledby`, `id` (for a `<label htmlFor>`) or `title`, and not inside a `<label>`;
 *  - `click-role`: a non-interactive element (`div`, `span`, `li`, `p`, `td`, `img`) with `onClick` and
 *    no `role`;
 *  - `button-name`: a `<button>` with no text content, `aria-label`, `aria-labelledby` or `title`.
 *
 * A tag with a `{...spread}` may carry any attribute and is skipped. The hard-coded-string and
 * theme-token proxies of this characteristic are the existing localize / token guards, run as L3
 * analyzers, not content rules.
 *
 * Heuristic: text-level JSX; WS4 tree-sitter JSX facts replace it.
 */

import type { DeltaRule } from '../../contract.js';
import { isTestPath, type TextView } from '../support/files.js';
import { hasAttr, isJsxPath, jsxTags, type JsxTag } from '../support/jsx.js';
import { stateSides, type Hit } from '../support/stateRule.js';

const NON_INTERACTIVE: ReadonlySet<string> = new Set(['div', 'span', 'li', 'p', 'td', 'img']);
const NAMED_BY = ['aria-label', 'aria-labelledby', 'title'];

const named = (tag: JsxTag, extra: readonly string[] = []) => [...NAMED_BY, ...extra].some((a) => hasAttr(tag, a));

/** Offsets of every `<label` / `</label` in the view, sorted (memoized). */
const labelMarks = (view: TextView): { opens: number[]; closes: number[] } => view.memo('labelMarks', () => ({
    opens: [...view.bare.matchAll(/<label\b/g)].map((m) => m.index),
    closes: [...view.bare.matchAll(/<\/label\b/g)].map((m) => m.index),
}));

/** The last mark before `offset`, or -1 (binary search over a sorted list). */
function lastBefore(marks: readonly number[], offset: number): number {
    let lo = 0, hi = marks.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (marks[m]! < offset) lo = m + 1; else hi = m; }
    return lo === 0 ? -1 : marks[lo - 1]!;
}

function insideLabel(view: TextView, offset: number): boolean {
    const { opens, closes } = labelMarks(view);
    return lastBefore(opens, offset) > lastBefore(closes, offset);
}

function buttonHasText(view: TextView, tag: JsxTag): boolean {
    if (tag.selfClosing) return false;
    const close = view.bare.indexOf('</button', tag.end);
    if (close < 0) return true;
    const inner = view.code.slice(tag.end, close).replace(/<[^>]*>/g, '');
    return inner.trim() !== '';
}

function keyOf(view: TextView, tag: JsxTag): string | undefined {
    if (tag.spread) return undefined;
    if (tag.name === 'img' && !hasAttr(tag, 'alt')) return 'img-alt';
    if ((tag.name === 'input' || tag.name === 'select' || tag.name === 'textarea')
        && !/\btype\s*=\s*["']hidden["']/.test(tag.attrs) && !named(tag, ['id']) && !insideLabel(view, tag.offset)) return 'input-label';
    if (NON_INTERACTIVE.has(tag.name) && hasAttr(tag, 'onClick') && !hasAttr(tag, 'role')) return 'click-role';
    if (tag.name === 'button' && !named(tag) && !buttonHasText(view, tag)) return 'button-name';
    return undefined;
}

function hitsOf(view: TextView): Hit[] {
    const hits: Hit[] = [];
    for (const tag of jsxTags(view)) {
        const key = keyOf(view, tag);
        if (key) hits.push({ offset: tag.offset, length: tag.end - tag.offset, key });
    }
    return hits;
}

export const a11yViolation: DeltaRule = {
    id: 'a11y-violation',
    version: 1,
    dimension: 'ilities.interaction-capability',
    reads: ['content'],
    derive(input) {
        return stateSides(a11yViolation, { files: (p) => isJsxPath(p) && !isTestPath(p), hits: hitsOf, severity: 'warn' }, input);
    },
};

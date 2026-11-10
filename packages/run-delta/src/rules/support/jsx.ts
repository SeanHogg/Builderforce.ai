/**
 * rules/support/jsx.ts — the JSX opening tags of one `.tsx` / `.jsx` file, by text over masked source
 * (WS4 tree-sitter JSX facts replace this), for the React rules (`render-hot`, C6.1) and the
 * accessibility rule (`a11y-violation`, C7 interaction capability). A `<Name` counts as a tag only in
 * an expression position (after `(`, `=`, `return`, `=>`, `>`, `{`, `,`, `?`, `:`, `&&`, `||`), so a
 * comparison or a type argument (`useState<string>(`) never does. Computed once per {@link TextView}.
 */

import type { TextView } from './files.js';

export interface JsxTag {
    name: string;
    /** Offset of the `<`. */
    offset: number;
    /** Offset just past the closing `>`. */
    end: number;
    /** The attribute text (comment-masked, strings intact). */
    attrs: string;
    /** The same span with strings blanked: what attribute NAMES are read from (a value `"alt"` is not an `alt`). */
    attrsBare: string;
    selfClosing: boolean;
    /** `{...props}`: any attribute may be present, so "missing attribute" checks skip the tag. */
    spread: boolean;
}

const OPEN = /<([A-Za-z][\w.:-]*)(?=[\s/>])/g;
const EXPRESSION_BEFORE = /(?:^|[(,=:?&|{}>[]|=>|\breturn|\byield)\s*$/;

export const isJsxPath = (path: string): boolean => /\.[jt]sx$/.test(path);

function compute(view: TextView): JsxTag[] {
    const { bare, code } = view;
    const out: JsxTag[] = [];
    for (const m of bare.matchAll(OPEN)) {
        if (!EXPRESSION_BEFORE.test(bare.slice(Math.max(0, m.index - 16), m.index))) continue;
        let depth = 0, j = m.index + m[0].length;
        for (; j < bare.length; j++) {
            const ch = bare[j]!;
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
            else if (depth === 0 && ch === '>') break;
            else if (depth === 0 && ch === '<') { j = bare.length; break; }
        }
        if (j >= bare.length) continue;
        const attrs = code.slice(m.index + m[0].length, j), attrsBare = bare.slice(m.index + m[0].length, j);
        out.push({ name: m[1]!, offset: m.index, end: j + 1, attrs, attrsBare, selfClosing: bare[j - 1] === '/', spread: /\{\s*\.\.\./.test(attrsBare) });
    }
    return out;
}

export function jsxTags(view: TextView): JsxTag[] {
    return view.memo('jsxTags', () => compute(view));
}

/** Whether a tag names an attribute (`alt`, `aria-label`, `onClick`); string VALUES never count. */
export function hasAttr(tag: JsxTag, name: string): boolean {
    return new RegExp(`(?<![\\w-])${name.replace(/[-]/g, '\\-')}(?![\\w-])`).test(tag.attrsBare);
}

/** Attributes whose value is a fresh object, array or function literal (`style={{…}}`, `onClick={() => …}`). */
export function inlineAttrs(tag: JsxTag): string[] {
    return [...tag.attrs.matchAll(/(?<![\w-])([A-Za-z][\w-]*)\s*=\s*\{\s*(?:\{|\[|(?:async\s+)?\([^()]*\)\s*(?::[^=]*)?=>|(?:async\s+)?[A-Za-z_$][\w$]*\s*=>|function\b)/g)]
        .map((m) => m[1]!).filter((a) => a !== 'key');
}

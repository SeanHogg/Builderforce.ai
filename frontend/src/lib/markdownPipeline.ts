import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type { PluggableList } from 'unified';

/**
 * The ONE markdown pipeline. Every `<ReactMarkdown>` on the platform spreads
 * these two lists and adds nothing of its own.
 *
 * ── WHY THIS MODULE EXISTS ───────────────────────────────────────────────────
 * There were six independent `remarkPlugins={[remarkGfm]}` literals — chat, the
 * document renderer, the blog, and three inside a canvas card. Six lists is six
 * chances to disagree, and they already did on the thing that matters most:
 * NONE of them could render mathematics. `$\frac{a}{b}$` in a document, note,
 * report, slide, PRD or course lesson came out as literal dollar-signed source,
 * so the canvas — a surface whose whole pitch is "any artifact" — could not hold
 * a single line of maths, physics or chemistry. Adding KaTeX to one of the six
 * would have made the same document render two different ways depending on which
 * surface opened it.
 *
 * `remark-math` parses `$inline$` and `$$display$$`; `rehype-katex` renders the
 * result to KaTeX HTML, which inherits `currentColor` and is therefore correct in
 * both themes with no per-theme rule (`.katex-display` gets its own horizontal
 * scroll in globals.css so a long equation cannot widen the page).
 *
 * `throwOnError: false` is deliberate: a half-typed formula is the NORMAL state
 * of a document being written. KaTeX renders what it can and marks the rest in
 * the error colour rather than throwing inside React's render and taking the
 * whole card down with it.
 */
export const MARKDOWN_REMARK_PLUGINS: PluggableList = [remarkGfm, remarkMath];

export const MARKDOWN_REHYPE_PLUGINS: PluggableList = [
  [rehypeKatex, { throwOnError: false, errorColor: 'var(--error-text, #ef4444)', strict: false }],
];

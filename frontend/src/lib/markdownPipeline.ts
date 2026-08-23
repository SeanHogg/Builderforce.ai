import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type { Options } from 'react-markdown';
import { remarkRichFormat } from './markdownRichFormat';

/**
 * The plugin-list type, taken from `react-markdown`'s own props rather than
 * imported from `unified`. `unified` is a transitive dependency here, not a
 * declared one, so a bare `import type … from 'unified'` does not resolve under
 * pnpm's strict node_modules and fails the production typecheck. Deriving it
 * from the consumer also guarantees the lists stay exactly what
 * `<ReactMarkdown>` accepts, whatever version of `unified` it resolves.
 */
type PluggableList = NonNullable<Options['remarkPlugins']>;

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

/**
 * The pipeline for a canvas DOCUMENT — the base plugins plus the attribute-span
 * vocabulary a document may carry (underline, colour, font, size, alignment).
 *
 * A separate list rather than an addition to the one above, because the base
 * list also renders CHAT: a model that happens to write `[a]{color=red}` in a
 * reply is quoting syntax, not formatting its own answer. A document is the
 * surface where those spans are authored, imported from Word, and exported back.
 */
export const DOCUMENT_REMARK_PLUGINS: PluggableList = [...MARKDOWN_REMARK_PLUGINS, remarkRichFormat];

export const MARKDOWN_REHYPE_PLUGINS: PluggableList = [
  [rehypeKatex, { throwOnError: false, errorColor: 'var(--error-text)', strict: false }],
];

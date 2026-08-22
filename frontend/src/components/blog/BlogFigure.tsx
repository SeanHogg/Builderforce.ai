import styles from './figures/figures.module.css';
import { renderFigure } from './figures/registry';
import { parseFigure, type FigureSpec } from './figures/types';

export { parseFigure };
export type { FigureSpec, FigureHue } from './figures/types';

/**
 * BlogFigure — the figure vocabulary for blog posts.
 *
 * ── WHY THIS EXISTS AND NOT RAW HTML ────────────────────────────────────────
 * Posts are markdown rendered by `<ReactMarkdown>` through the ONE shared
 * pipeline (`lib/markdownPipeline`), which deliberately has no `rehype-raw`.
 * That is correct and must stay correct: the same pipeline renders chat
 * messages, canvas cards and imported documents, so enabling raw HTML for the
 * blog would enable it for every string a user can put in front of another
 * user. An `<svg onload>` in a shared canvas note is not a hypothetical.
 *
 * So a figure is DATA, not markup. A post writes a fenced block:
 *
 *     ```bf-figure
 *     { "kind": "screen", "frame": "…", "regions": [ … ] }
 *     ```
 *
 * and this renders it. Nine kinds, chosen because they are the shapes the
 * product's own ideas actually have — a sequence, a trade-off, a ladder, a
 * ranking, a contrast, a picture of an interface, frames at real widths, a
 * résumé template and a deep link — rather than chart types looking for a use.
 *
 * ── WHY A DRAWN INTERFACE AND NOT A SCREENSHOT ──────────────────────────────
 * `screen` and `devices` draw a capability's SHAPE from tokens and geometry. A
 * screenshot would be stale the day the product moves, would carry whatever
 * data was on screen when it was taken, and would be one flat image served into
 * two themes. A figure is a few numbers in a markdown file and reads correctly
 * in both.
 *
 * ── HOW A TENTH KIND LANDS ──────────────────────────────────────────────────
 * A spec in `figures/types.ts`, a component beside it, one line in
 * `figures/registry.tsx`. This file does not change, because it holds no
 * knowledge of any particular kind — only the chrome every figure shares.
 *
 * Every colour is a token, so a figure is legible in both themes, and every
 * width is fluid or scrolls inside its own container, so a wide figure never
 * makes the page scroll sideways.
 *
 * No `'use client'`: this holds no state and calls no hook. Its only consumer
 * is the post renderer, which is already a client component, so the directive
 * would add a file to the client-boundary ratchet and buy nothing.
 */
export default function BlogFigure({ spec }: { spec: FigureSpec }) {
  return (
    <figure className={styles.figure}>
      {spec.title && <p className={styles.title}>{spec.title}</p>}
      {renderFigure(spec)}
      {spec.caption && <figcaption className={styles.caption}>{spec.caption}</figcaption>}
    </figure>
  );
}

import type { CSSProperties, ReactNode } from 'react';

type PageWidth = 'full' | 'readable' | 'narrow';

type PageContainerProps = {
  /**
   * `full` (default) fills the content column edge-to-edge — board, list, table,
   * and data pages. `readable` caps multi-section form / reading pages; `narrow`
   * caps single-column detail / editor pages.
   *
   * The tier names the MEASURE. It does not name the alignment, and that split
   * is the fix: the cap used to be an inline `max-width` with a comment saying
   * "kept LEFT-aligned, never centered", which is right beside a sidebar and
   * wrong without one. A public page in the marketing shell — `/talent/<id>`,
   * every browse detail — has no rail to sit against, so the same rule that
   * removes a dead gutter in the app opened a 900px one on the public surface:
   * a 1100px column pinned to the left of a 1920px screen with nothing in the
   * remaining half. `/pricing` never had the bug because it caps and centres
   * itself in its own module, which is the drift this component exists to stop.
   *
   * So the measure is published as `--page-max` and the SHELL owns the
   * alignment (see `.page-container` in globals.css): left against the rail,
   * centred at the marketing measure without one. One rule each, in the place
   * that knows the answer.
   */
  width?: PageWidth;
  /** Override the default page padding (and any other container style). */
  style?: CSSProperties;
  className?: string;
  children: ReactNode;
};

/** Max line-length tiers for capped pages.
 *
 *  `none` rather than an absent value on purpose: `--page-max` inherits, so a
 *  full-bleed container nested inside a capped one would otherwise silently
 *  adopt its parent's measure. */
const MAX: Record<PageWidth, string> = {
  full: 'none',
  readable: '1100px',
  narrow: '720px',
};

/**
 * Canonical wrapper for app + public pages (rendered inside AppShell's
 * `.content`, PublicShell's, or the marketing shell's `.marketing-content`).
 * Centralizes page width + alignment so individual pages no longer re-invent —
 * and drift on — the `max-width` + `margin: 0 auto` pattern.
 *
 * Full-bleed routes (the IDE, the Brain page, the workflow builder canvas) manage
 * their own layout and intentionally do NOT use this.
 */
export default function PageContainer({ width = 'full', style, className, children }: PageContainerProps) {
  return (
    <div
      // `.page-container` owns the padding so it can shrink on mobile (a media
      // query can't reach an inline `style`), and it owns the alignment so the
      // shell can decide it. A `style={{ padding }}` override passed by a page
      // still wins — inline beats the class.
      className={`page-container${className ? ` ${className}` : ''}`}
      data-width={width}
      style={{
        width: '100%',
        // A custom property rather than `max-width` directly: an inline
        // `max-width` cannot be widened by the shell, and the marketing shell
        // needs to widen `readable` to the marketing measure so a public page
        // and `/pricing` are the same column.
        ...({ '--page-max': MAX[width] } as CSSProperties),
        color: 'var(--text-primary)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

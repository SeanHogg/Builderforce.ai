import type { CSSProperties, ReactNode } from 'react';

/** Max line-length tiers for capped pages — all kept LEFT-aligned, never centered. */
const READABLE_MAX = 1100;
const NARROW_MAX = 720;

type PageContainerProps = {
  /**
   * `full` (default) fills the content column edge-to-edge — board, list, table,
   * and data pages. `readable` ({@link READABLE_MAX}) caps multi-section form /
   * reading pages; `narrow` ({@link NARROW_MAX}) caps single-column detail /
   * editor pages. Capped tiers stay LEFT-aligned so there is never a dead gutter
   * beside the sidebar, and on mobile the caps are ignored entirely (see the
   * `.page-container` mobile rule in globals.css) so every page is 100% wide.
   */
  width?: 'full' | 'readable' | 'narrow';
  /** Override the default page padding (and any other container style). */
  style?: CSSProperties;
  className?: string;
  children: ReactNode;
};

/**
 * Canonical wrapper for authenticated app pages (rendered inside AppShell's
 * `.content`). Centralizes page width + alignment so individual pages no longer
 * re-invent — and drift on — the `max-width` + `margin: 0 auto` pattern that
 * left a large empty gutter next to the sidebar on wide screens.
 *
 * Full-bleed routes (the IDE, the Brain page, the workflow builder canvas) manage
 * their own layout and intentionally do NOT use this.
 */
export default function PageContainer({ width = 'full', style, className, children }: PageContainerProps) {
  return (
    <div
      // `.page-container` owns the padding so it can shrink on mobile (a media
      // query can't reach an inline `style`). A `style={{ padding }}` override
      // passed by a page still wins — inline beats the class.
      //
      // The width tier is a data attribute rather than an inline `max-width` for
      // the same reason: the mobile media query has to be able to drop the cap
      // so narrow/readable pages also run the full 100% of the viewport.
      className={`page-container${className ? ` ${className}` : ''}`}
      data-width={width}
      style={{
        width: '100%',
        color: 'var(--text-primary)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

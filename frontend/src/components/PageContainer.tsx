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
   * beside the sidebar.
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
  // Mobile-safe bottom padding: accounts for the fixed footer nav (56px) + safe area
  const mobileBottomPadding = process.env.TARGET === 'mobile'
    ? 'padding-bottom: calc(56px + env(safe-area-inset-bottom, 0px));'
    : '';
  const safeStyle = {
    width: '100%',
    maxWidth: width === 'readable' ? READABLE_MAX : width === 'narrow' ? NARROW_MAX : undefined,
    color: 'var(--text-primary)',
    ...style,
    ...mobileBottomPadding ? {} : {}, // Don't override inline styles
  };

  return (
    <div
      // `.page-container` owns the padding so it can shrink on mobile (a media
      // query can't reach an inline `style`). A `style={{ padding }}` override
      // passed by a page still wins — inline beats the class.
      className={`page-container${className ? ` ${className}` : ''}`}
      style={safeStyle}
    >
      {children}
    </div>
  );
}

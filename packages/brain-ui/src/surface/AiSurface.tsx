import type { ReactNode } from 'react';

/**
 * <AiSurface> — the ONE body every AI modality mounts (the web Brain panel and Studio
 * column, the canvas Chat lens and board dock, the guest drawer, the VS Code panel, the
 * Rovr side panel). Extracted from the web panel's conversation column
 * (`BrainConversation`), whose order is the design's anatomy:
 *
 *   header · rail · thread (or the empty state) · notices · footer
 *
 * It owns ORDER and the column's flex contract, nothing else — each slot is the shared
 * part (`SurfaceHeader`, `ChatTicketsPanel`, `BrainTimeline` / `SurfaceEmptyState`,
 * `ChatErrorBanner`, `SurfaceFooter`) bound by its host. Notices sit between the thread
 * and the footer, so what went wrong reads next to the box you answer it from, on every
 * host instead of above the thread on some and below it on others.
 */
export interface AiSurfaceProps {
  header?: ReactNode;
  /** The conversation's rail (linked tickets, spend) — hosts pass it once a chat exists. */
  rail?: ReactNode;
  /** The transcript (`BrainTimeline`). Ignored while `empty` is given. */
  thread?: ReactNode;
  /** Before the first message (`SurfaceEmptyState`); given ⇒ shown instead of the thread. */
  empty?: ReactNode;
  /** Banners about the run — the error card, allowance, provider fallbacks. */
  notices?: ReactNode;
  /** The pinned footer (`SurfaceFooter`): approval, open question, composer. */
  footer?: ReactNode;
  /** Host placement / palette mapping. */
  className?: string;
  /** Accessible name for the region (localized by the host). */
  label?: string;
}

export function AiSurface({ header, rail, thread, empty, notices, footer, className, label }: AiSurfaceProps) {
  return (
    <section className={['bf-surface', className].filter(Boolean).join(' ')} aria-label={label}>
      {header}
      {rail != null && rail !== false && <div className="bf-surface__rail">{rail}</div>}
      <div className="bf-surface__body">{empty ?? thread}</div>
      {notices != null && notices !== false && <div className="bf-surface__notices">{notices}</div>}
      {footer}
    </section>
  );
}

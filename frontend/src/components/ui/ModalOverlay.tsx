'use client';

/**
 * THE centered overlay every modal in the app stands in.
 *
 * ── WHY IT EXISTS ────────────────────────────────────────────────────────────
 * Four surfaces had independently written the same chrome — `className=
 * "modal-overlay"`, `role="dialog"`, `aria-modal`, a backdrop click that has to
 * check `e.target === e.currentTarget`, and (for two of them) a `keydown`
 * listener that closes on Escape — and they disagreed with each other: one
 * portalled to `<body>` so a parent's `overflow`/stacking context could not clip
 * it and the others did not, one closed on Escape and the others left a visitor
 * with no keyboard way out. The chrome is one decision, so it lives in one
 * place; what stands INSIDE it is the caller's.
 *
 * ── WHAT IT DOES NOT DECIDE ──────────────────────────────────────────────────
 * Nothing about the card: `.modal-overlay > div` (globals.css) already gives the
 * single child a solid drawer background and caps its height to the viewport, so
 * a caller styles its own width, padding and actions and this component never
 * reaches into them. Nor does it decide WHEN to open — `open` is the caller's
 * fact, and `onDismiss` being absent is how a modal says it is not dismissible
 * from the backdrop (a full-screen stage that owns its own close button).
 *
 * Per the app-wide overlay convention a centered modal is reserved for terminal
 * approvals and for the account wall a signed-out visitor must be able to read;
 * everything else is a `SlideOutPanel`.
 */

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

export interface ModalOverlayProps {
  /** Defaults to `true`, so a caller that only mounts it when open need not say so. */
  open?: boolean;
  /**
   * Backdrop click and Escape. Omitted ⇒ neither dismisses, for a modal whose
   * own content owns the only way out.
   */
  onDismiss?: () => void;
  /** `id` of the heading inside the card. */
  labelledBy?: string;
  /** `id` of the body copy inside the card. */
  describedBy?: string;
  /** Used only when there is no heading element to point `labelledBy` at. */
  label?: string;
  className?: string;
  style?: React.CSSProperties;
  /** Extra attributes for the overlay element (`data-*` hooks, mostly). */
  overlayProps?: React.HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, string>;
  children: React.ReactNode;
}

export function ModalOverlay({
  open = true,
  onDismiss,
  labelledBy,
  describedBy,
  label,
  className,
  style,
  overlayProps,
  children,
}: ModalOverlayProps) {
  useEffect(() => {
    if (!open || !onDismiss) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onDismiss]);

  if (!open) return null;

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-label={labelledBy ? undefined : label}
      {...overlayProps}
      className={className ? `modal-overlay ${className}` : 'modal-overlay'}
      style={style}
      onClick={(e) => {
        if (onDismiss && e.target === e.currentTarget) onDismiss();
      }}
    >
      {children}
    </div>
  );

  // Portal to <body> so a parent stacking context / `overflow: hidden` — the
  // full-screen canvas shell, above all — cannot clip or corner the modal.
  return typeof document !== 'undefined' ? createPortal(overlay, document.body) : overlay;
}

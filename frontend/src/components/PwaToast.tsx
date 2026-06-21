'use client';

import type { CSSProperties, ReactNode } from 'react';
import { PWA_TOAST_ROW_HEIGHT } from './pwaToastStack';

/**
 * Shared presentational shell for the bottom-center PWA toasts
 * (update-available + install-app). Owns the fixed positioning, blur, border,
 * shadow, and the coral primary-action button so the two banners stay visually
 * identical without duplicating the chrome.
 *
 * `slot` is the toast's index in the shared bottom-center stack (0 = bottom-most
 * row). When two toasts are live at once they pass different slots so they
 * stack vertically instead of overlapping at the same `bottom`. A lone toast
 * passes slot 0 (or omits it) and sits in the normal position.
 */

const BOTTOM_BASE = 24;

const SHELL_STYLE: CSSProperties = {
  position: 'fixed',
  bottom: BOTTOM_BASE,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 9999,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '12px 16px 12px 20px',
  background: 'var(--bg-surface, #1a1a24)',
  border: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
  borderRadius: 14,
  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
  backdropFilter: 'blur(16px)',
  maxWidth: 'calc(100vw - 48px)',
};

const TEXT_STYLE: CSSProperties = {
  fontSize: '0.875rem',
  color: 'var(--text-primary, #e8e8f0)',
  fontFamily: 'var(--font-body, sans-serif)',
};

const PRIMARY_BUTTON_STYLE: CSSProperties = {
  padding: '6px 14px',
  background: 'linear-gradient(135deg, var(--coral-bright, #f4726e), var(--coral-dark, #c94f4b))',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  fontFamily: 'var(--font-display, sans-serif)',
  fontWeight: 700,
  fontSize: '0.8rem',
  cursor: 'pointer',
  letterSpacing: '0.02em',
  flexShrink: 0,
};

const DISMISS_BUTTON_STYLE: CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--text-muted, #6b6b80)',
  cursor: 'pointer',
  fontSize: '1rem',
  lineHeight: 1,
  padding: '2px 4px',
  flexShrink: 0,
};

export function PwaToast({
  children,
  nowrap = true,
  slot = 0,
}: {
  children: ReactNode;
  nowrap?: boolean;
  /** Index in the shared bottom-center stack (0 = bottom-most). Offsets `bottom`. */
  slot?: number;
}) {
  const bottom = BOTTOM_BASE + Math.max(0, slot) * PWA_TOAST_ROW_HEIGHT;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{ ...SHELL_STYLE, bottom, whiteSpace: nowrap ? 'nowrap' : 'normal' }}
    >
      {children}
    </div>
  );
}

export function PwaToastText({ children }: { children: ReactNode }) {
  return <span style={TEXT_STYLE}>{children}</span>;
}

export function PwaToastPrimaryButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} style={PRIMARY_BUTTON_STYLE}>
      {children}
    </button>
  );
}

export function PwaToastDismissButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Dismiss notification" style={DISMISS_BUTTON_STYLE}>
      ✕
    </button>
  );
}

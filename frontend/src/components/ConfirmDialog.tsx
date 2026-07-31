'use client';

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';

export interface ConfirmDialogProps {
  open: boolean;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Optional heading above the message. */
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive actions (default) get the coral button; neutral confirmations
   *  (e.g. "convert", "downgrade") get the accent button. */
  destructive?: boolean;
}

/**
 * The canonical in-app confirmation modal — the replacement for the browser's
 * native `window.confirm()`. Per the app-wide overlay convention (see
 * SlideOutPanel) a centered modal is reserved for exactly this: terminal /
 * destructive approvals. Most callers should NOT render this directly — use the
 * promise-based `useConfirm()` hook (ConfirmProvider), which mounts a single
 * shared instance and returns `Promise<boolean>` so an imperative
 * `if (!(await confirm(...))) return;` reads just like the old `confirm()`.
 */
export function ConfirmDialog({
  open,
  message,
  onConfirm,
  onCancel,
  title,
  confirmLabel,
  cancelLabel,
  destructive = true,
}: ConfirmDialogProps) {
  const t = useTranslations('common');

  // ESC cancels; Enter confirms — parity with the native prompt's keyboard UX.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      else if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel, onConfirm]);

  if (!open) return null;

  const accent = destructive ? 'var(--coral-bright)' : 'var(--accent)';
  const body = (
    <div
      role="dialog"
      aria-modal="true"
      className="modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)',
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          maxWidth: 480,
          width: '100%',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          padding: 24,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <h2 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</h2>
        )}
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--text-primary)' }}>{message}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onCancel(); }}
            style={{
              padding: '8px 14px',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              background: 'var(--bg-base)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            {cancelLabel ?? t('cancel')}
          </button>
          <button
            type="button"
            autoFocus
            onClick={(e) => { e.stopPropagation(); onConfirm(); }}
            style={{
              padding: '8px 14px',
              border: `1px solid ${accent}`,
              borderRadius: 8,
              background: accent,
              color: '#fff',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            {confirmLabel ?? t('delete')}
          </button>
        </div>
      </div>
    </div>
  );

  // Portal to <body> so parent stacking contexts / overflow can't clip it.
  return typeof document !== 'undefined' ? createPortal(body, document.body) : body;
}

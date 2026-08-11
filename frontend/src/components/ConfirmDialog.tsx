'use client';

import React, { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Button, Surface } from '@/components/ui';
import styles from './ConfirmDialog.module.css';

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
  const titleId = useId();
  const messageId = useId();

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

  const body = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
      aria-describedby={messageId}
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <Surface tone="raised" padding="lg" className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        {title && (
          <h2 id={titleId} className={styles.title}>{title}</h2>
        )}
        <p id={messageId} className={styles.message}>{message}</p>
        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={(e) => { e.stopPropagation(); onCancel(); }}>
            {cancelLabel ?? t('cancel')}
          </Button>
          <Button type="button" variant={destructive ? 'danger' : 'primary'} autoFocus onClick={(e) => { e.stopPropagation(); onConfirm(); }}>
            {confirmLabel ?? t('delete')}
          </Button>
        </div>
      </Surface>
    </div>
  );

  // Portal to <body> so parent stacking contexts / overflow can't clip it.
  return typeof document !== 'undefined' ? createPortal(body, document.body) : body;
}

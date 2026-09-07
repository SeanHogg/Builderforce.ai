'use client';

import type { FormEvent, ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { Button } from '@/components/ui';
import styles from './SessionEditorPanel.module.css';

interface Props {
  open: boolean;
  title: string;
  description: string;
  submitLabel: string;
  busy?: boolean;
  error?: string;
  onSubmit: () => void;
  onClose: () => void;
  children: ReactNode;
}

/**
 * The one form surface for every session edit — rename, move, merge, and the
 * bulk merge above the library.
 *
 * A slide-out rather than a centered modal because that is the app-wide
 * convention (`components/SlideOutPanel`): a modal is reserved for terminal
 * destructive approvals, which these are not — the delete and merge
 * CONFIRMATIONS still go through `useConfirm`.
 */
export function SessionEditorPanel({ open, title, description, submitLabel, busy = false, error, onSubmit, onClose, children }: Props) {
  const t = useTranslations('sessionManagement');
  const submit = (event: FormEvent) => { event.preventDefault(); onSubmit(); };
  return (
    <SlideOutPanel open={open} onClose={onClose} title={title} width="sheet">
      <form className={styles.form} onSubmit={submit}>
        <p className={styles.description}>{description}</p>
        {children}
        {error && <p className={styles.error} role="alert">{error}</p>}
        <footer className={styles.actions}>
          <Button type="button" variant="secondary" onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" variant="primary" loading={busy}>{submitLabel}</Button>
        </footer>
      </form>
    </SlideOutPanel>
  );
}

// No `'use client'`: imported only by `ChatInput`, a client component.

import { memo } from 'react';
import { useTranslations } from 'next-intl';
import styles from './composerSuggestions.module.css';
import type { ComposerSuggestion } from './types';

/**
 * Fixed next steps as chips above an empty box — "what now?" answered without a model
 * call. A chip seeds the box; the person reads it, edits it, and sends it.
 */
export const ComposerSuggestions = memo(function ComposerSuggestions({ items }: { items: readonly ComposerSuggestion[] }) {
  const t = useTranslations('chatInput');
  if (items.length === 0) return null;
  return (
    <div className={styles.row} role="group" aria-label={t('suggestionsLabel')} data-testid="composer-suggestions">
      {items.map((item) => (
        <button key={item.id} type="button" className={styles.chip} onClick={item.onSelect}>
          {item.label}
        </button>
      ))}
    </div>
  );
});

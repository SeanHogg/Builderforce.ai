'use client';

import { useId, type FormEvent, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';

/**
 * The Studio prompt: what to build. Enter sends, Shift+Enter starts a new line.
 * Presentational; the page owns the value and what sending means.
 */
export function StudioPromptBox({ value, onChange, onSubmit, busy }: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  const t = useTranslations('studio.home');
  const id = useId();
  const canSend = value.trim().length > 0 && !busy;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canSend) onSubmit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (canSend) onSubmit();
    }
  };

  return (
    <form
      onSubmit={submit}
      style={{
        display: 'grid',
        gap: 10,
        padding: 14,
        borderRadius: 'var(--radius-xl)',
        border: '1px solid var(--border-subtle)',
        background: 'var(--surface-card, var(--bg-elevated))',
        boxShadow: 'var(--shadow-lg, none)',
      }}
    >
      <label htmlFor={id} className="sr-only">{t('promptLabel')}</label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t('placeholder')}
        rows={3}
        className="ui-input ui-textarea"
        style={{ border: 0, background: 'transparent', resize: 'vertical', minHeight: 84 }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>{t('hint')}</span>
        <Button type="submit" variant="primary" disabled={!canSend} loading={busy}>{t('submit')}</Button>
      </div>
    </form>
  );
}

'use client';

import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from './Button';

/**
 * A one-field "name it" form that replaces `window.prompt`.
 *
 * The native prompt cannot be styled, cannot be translated past its message,
 * blocks the whole page and — in an embedded webview — may not open at all.
 * This is the same ask as an inline row: type a name, Enter or the button
 * submits, Escape or Cancel closes it. It owns the draft; the caller owns what
 * happens with the name and when the form is shown.
 */
export function InlineNameForm({
  placeholder,
  submitLabel,
  onSubmit,
  onCancel,
  busy = false,
}: {
  placeholder: string;
  submitLabel: string;
  onSubmit: (name: string) => void | Promise<void>;
  onCancel: () => void;
  busy?: boolean;
}) {
  const tc = useTranslations('common');
  const [value, setValue] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const name = value.trim();
    if (!name || busy) return;
    void onSubmit(name);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
      <input
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={placeholder}
        disabled={busy}
        style={{
          flex: '1 1 140px',
          minWidth: 0,
          padding: '6px 8px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          color: 'var(--text-primary)',
          fontSize: 'var(--font-size-body)',
        }}
      />
      <Button type="submit" size="sm" variant="primary" disabled={!value.trim()} loading={busy}>{submitLabel}</Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>{tc('cancel')}</Button>
    </form>
  );
}

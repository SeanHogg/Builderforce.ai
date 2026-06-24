'use client';

import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { LOCALES, LOCALE_LABELS, LOCALE_COOKIE, type Locale } from '@/i18n/config';

/**
 * Cookie-based locale switcher. Writes the `NEXT_LOCALE` preference and calls
 * router.refresh() so the server re-resolves messages for the new locale — no
 * URL change, no full reload. Self-contained: reads the active locale itself,
 * so consumers just drop it in.
 */
export default function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const onChange = (next: Locale) => {
    if (next === locale) return;
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    startTransition(() => router.refresh());
  };

  return (
    <select
      value={locale}
      onChange={(e) => onChange(e.target.value as Locale)}
      disabled={pending}
      aria-label="Language"
      style={{
        padding: '6px 12px',
        fontSize: 13,
        fontWeight: 600,
        background: 'var(--bg-elevated)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
        cursor: pending ? 'wait' : 'pointer',
      }}
    >
      {LOCALES.map((l) => (
        <option key={l} value={l}>
          {LOCALE_LABELS[l]}
        </option>
      ))}
    </select>
  );
}

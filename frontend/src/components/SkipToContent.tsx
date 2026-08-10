'use client';

import { useTranslations } from 'next-intl';

/**
 * The keyboard skip link — visually hidden until focused (see `.skip-to-content`
 * in globals.css), and the FIRST focusable element on every page.
 *
 * It is a client component for one reason: this app resolves its locale on the
 * CLIENT (see LocaleProvider — reading the cookie on the server would opt every
 * route out of static generation), so anything translated has to live inside
 * `NextIntlClientProvider`. Keep it rendered as the provider's first child so
 * nothing focusable can precede it.
 */
export function SkipToContent() {
  const t = useTranslations('common');
  return <a className="skip-to-content" href="#main-content">{t('skipToContent')}</a>;
}

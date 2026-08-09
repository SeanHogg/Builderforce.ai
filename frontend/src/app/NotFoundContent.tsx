'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

export default function NotFoundContent() {
  const t = useTranslations('notFound');
  return (
    <div
      style={{
        minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', textAlign: 'center', gap: 12, padding: '48px 20px',
      }}
    >
      <div style={{ fontSize: 'var(--font-size-page-title)', fontWeight: 800, color: 'var(--text-strong)', lineHeight: 1 }}>404</div>
      <h1 style={{ fontSize: 'var(--font-size-section)', fontWeight: 700, color: 'var(--text-strong)', margin: 0 }}>{t('title')}</h1>
      <p style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-secondary)', maxWidth: 460, margin: 0 }}>{t('message')}</p>
      <Link
        href="/"
        style={{
          marginTop: 8, padding: '10px 20px', fontSize: 'var(--font-size-small)', fontWeight: 700, borderRadius: 'var(--radius-lg)',
          background: 'var(--accent)', color: 'var(--text-on-accent)', textDecoration: 'none',
        }}
      >
        {t('home')}
      </Link>
    </div>
  );
}

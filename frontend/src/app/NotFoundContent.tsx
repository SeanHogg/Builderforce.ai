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
      <div style={{ fontSize: 56, fontWeight: 800, color: 'var(--text-strong)', lineHeight: 1 }}>404</div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-strong)', margin: 0 }}>{t('title')}</h1>
      <p style={{ fontSize: 15, color: 'var(--text-secondary)', maxWidth: 460, margin: 0 }}>{t('message')}</p>
      <Link
        href="/"
        style={{
          marginTop: 8, padding: '10px 20px', fontSize: 14, fontWeight: 700, borderRadius: 10,
          background: 'var(--accent)', color: '#fff', textDecoration: 'none',
        }}
      >
        {t('home')}
      </Link>
    </div>
  );
}

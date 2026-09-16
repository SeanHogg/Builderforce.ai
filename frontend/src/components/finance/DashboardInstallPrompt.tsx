/**
 * Empty-state CTA on /finance?tab=dashboard when the tenant has no saved
 * dashboard yet (PRD 25 A6). Points at the matching vertical template so the
 * installer, not a second composer, is how a founder gets tiles.
 */

import Link from 'next/link';
import { useTranslations } from 'next-intl';

export function DashboardInstallPrompt({ templateKey }: { templateKey: string }) {
  const t = useTranslations('financeHub');
  const href = `/templates?open=${encodeURIComponent(templateKey)}`;
  return (
    <div
      style={{
        padding: 24,
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-elevated)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        maxWidth: 560,
      }}
    >
      <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('dashboard.installPrompt')}</p>
      <Link
        href={href}
        style={{
          alignSelf: 'flex-start',
          padding: '8px 14px',
          borderRadius: 'var(--radius-md)',
          background: 'var(--coral-bright)',
          color: 'var(--text-on-accent)',
          fontWeight: 600,
          textDecoration: 'none',
        }}
      >
        {t('dashboard.installCta')}
      </Link>
    </div>
  );
}

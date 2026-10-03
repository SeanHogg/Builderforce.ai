'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import { useAuth } from '@/lib/AuthContext';
import { useSignInDialog } from '@/components/auth/signIn/SignInDialogProvider';
import { STUDIO_ROUTE } from '@/lib/studio/studioHost';

/**
 * Studio's one bar: the mark (home), whatever the page puts in the middle and on
 * the right (`children`, e.g. a project's actions), and the account control,
 * which owns its own signed-in / signed-out decision.
 */
export function StudioTopBar({ title, children }: { title?: string; children?: ReactNode }) {
  const t = useTranslations('studio.topBar');
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        padding: '10px clamp(12px, 3vw, 24px)',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-deep)',
      }}
    >
      <Link href={STUDIO_ROUTE} aria-label={t('home')} style={{ color: 'var(--text-primary)', textDecoration: 'none', fontWeight: 800, fontFamily: 'var(--font-display)' }}>
        Builderforce <span style={{ color: 'var(--accent)' }}>Studio</span>
      </Link>
      {title && (
        <span style={{ color: 'var(--text-secondary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 120px' }}>
          / {title}
        </span>
      )}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {children}
        <AccountControl />
      </div>
    </header>
  );
}

function AccountControl() {
  const t = useTranslations('studio.topBar');
  const { authReady, isAuthenticated, user, logout } = useAuth();
  const { requestSignIn } = useSignInDialog();
  if (!authReady) return null;

  if (!isAuthenticated) {
    return (
      <>
        <Button type="button" variant="ghost" size="sm" onClick={requestSignIn}>{t('signIn')}</Button>
        <Button type="button" variant="primary" size="sm" onClick={requestSignIn}>{t('getStarted')}</Button>
      </>
    );
  }

  const initial = (user?.name || user?.email || '?').trim().charAt(0).toUpperCase();
  return (
    <>
      <span
        aria-hidden
        title={user?.email ?? undefined}
        style={{ width: 32, height: 32, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', fontWeight: 700 }}
      >
        {initial}
      </span>
      <Button type="button" variant="ghost" size="sm" onClick={logout}>{t('signOut')}</Button>
    </>
  );
}

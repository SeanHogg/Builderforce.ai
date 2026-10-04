// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { BrandLockup } from '@/components/BrandLockup';
import { Button } from '@/components/ui';
import { useAuth } from '@/lib/AuthContext';
import { useSignInDialog } from '@/components/auth/signIn/SignInDialogProvider';
import { STUDIO_ROUTE } from '@/lib/studio/studioHost';

/**
 * Studio's one bar: the mark (home), whatever the page puts on the right
 * (`children`, e.g. a project's actions), and the account control, which owns
 * its own signed-in / signed-out decision.
 *
 * It does NOT name the project. It used to take a `title`, which put the name
 * in the bar while the workspace directly below was already showing it in its
 * rename field and again in its description — one string, three places, two
 * rows apart. Naming the thing you are looking at is the workspace's job.
 */
export function StudioTopBar({ children }: { children?: ReactNode }) {
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
      {/* The mark is not optional and `Studio` is not the accent colour: both
          halves of the wordmark are `--text-primary`, so it reads white on the
          dark bar and dark on a light one. */}
      <BrandLockup href={STUDIO_ROUTE} label={t('home')} size={26}>
        <span style={{ color: 'var(--text-primary)', fontWeight: 800, fontFamily: 'var(--font-display)', letterSpacing: '-0.01em' }}>
          Builderforce Studio
        </span>
      </BrandLockup>
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

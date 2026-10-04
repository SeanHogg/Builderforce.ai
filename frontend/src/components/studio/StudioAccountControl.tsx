// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import { AnchoredPopover } from '@/components/ui/AnchoredPopover';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '@/lib/AuthContext';
import { useSignInDialog } from '@/components/auth/signIn/SignInDialogProvider';
import { invalidateConsumption } from '@/lib/useConsumption';
import { usePlanSummary } from '@/lib/usePlanSummary';
import { openFeedback } from '@/lib/feedbackEvents';
import { useFormat } from '@/i18n/useFormat';
import styles from '@/components/builder/workspaceChrome.module.css';

/**
 * Studio's account control. Signed out: sign in / get started. Signed in: ONE
 * pill — the plan and the person — that opens the account menu (the plan and how
 * to change it, settings, feedback, sign out). The plan used to be a separate
 * "FREE UPGRADE" chip and sign-out a bare text link beside the avatar: three
 * controls in a header that has room for one.
 */
export function StudioAccountControl() {
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

  return <AccountMenu name={user?.name ?? null} email={user?.email ?? null} onSignOut={logout} />;
}

function AccountMenu({ name, email, onSignOut }: { name: string | null; email: string | null; onSignOut: () => void }) {
  const t = useTranslations('studio.topBar');
  const tPlan = useTranslations('planBadge');
  const fmt = useFormat();
  const plan = usePlanSummary();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const initial = (name || email || '?').trim().charAt(0).toUpperCase();
  const close = () => setOpen(false);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={styles.accountPill}
        onClick={() => setOpen((was) => !was)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('account')}
        title={email ?? undefined}
      >
        {plan && <span className={styles.accountPlan} style={{ color: plan.tone }}>{plan.label}</span>}
        <span className={styles.avatar} aria-hidden>{initial}</span>
      </button>
      <AnchoredPopover open={open} anchorRef={anchorRef} onDismiss={close} placement="below" align="end">
        <div role="menu" aria-label={t('account')} className={styles.menu}>
          {(name || email) && (
            <div style={{ padding: '6px 10px 4px', display: 'grid', gap: 2, minWidth: 0 }}>
              {name && <strong style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-primary)' }}>{name}</strong>}
              {email && <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{email}</span>}
            </div>
          )}
          {plan && (
            <>
              <div className={styles.menuSep} />
              <Link
                href={plan.href}
                role="menuitem"
                className={styles.menuItem}
                title={plan.title}
                onClick={() => { invalidateConsumption(); close(); }}
                style={{ textDecoration: 'none' }}
              >
                <Icon name="billing" size={16} />
                <span style={{ flex: 1 }}>
                  {t('planLine', { plan: plan.label })}
                  {plan.remaining !== null && (
                    <span style={{ color: 'var(--text-muted)' }}>
                      {' · '}{plan.exhausted ? tPlan('noTokens') : tPlan('tokensLeft', { count: fmt.number(plan.remaining) })}
                    </span>
                  )}
                </span>
                <span style={{ color: plan.tone, fontWeight: 700 }}>{plan.isFree ? tPlan('upgrade') : t('managePlan')}</span>
              </Link>
            </>
          )}
          <div className={styles.menuSep} />
          <Link href="/settings" role="menuitem" className={styles.menuItem} onClick={close} style={{ textDecoration: 'none' }}>
            <Icon name="settings" size={16} />
            {t('settings')}
          </Link>
          <button type="button" role="menuitem" className={styles.menuItem} onClick={() => { close(); openFeedback(); }}>
            <Icon name="megaphone" size={16} />
            {t('feedback')}
          </button>
          <div className={styles.menuSep} />
          <button type="button" role="menuitem" className={styles.menuItem} onClick={() => { close(); onSignOut(); }}>
            <Icon name="sign-out" size={16} />
            {t('signOut')}
          </button>
        </div>
      </AnchoredPopover>
    </>
  );
}

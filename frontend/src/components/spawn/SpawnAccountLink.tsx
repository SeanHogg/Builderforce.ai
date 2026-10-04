'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { useSignInDialog } from '@/components/auth/signIn/SignInDialogProvider';
import { SPAWN_ACCOUNT_ROUTE } from '@/lib/spawn/spawnLinks';
import styles from './spawn.module.css';

/** The bar's account entry: "Sign in" opens the pop-up; signed in, "My account". */
export function SpawnAccountLink() {
  const t = useTranslations('spawn.shell');
  const { authReady, isAuthenticated } = useAuth();
  const { requestSignIn } = useSignInDialog();
  if (!authReady) return null;
  if (isAuthenticated) {
    return <Link href={SPAWN_ACCOUNT_ROUTE} className={styles.ctaGhost}>{t('account')}</Link>;
  }
  return <button type="button" className={styles.ctaGhost} onClick={requestSignIn}>{t('signIn')}</button>;
}

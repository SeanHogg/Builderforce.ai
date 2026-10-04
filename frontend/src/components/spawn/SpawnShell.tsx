import type { ReactNode } from 'react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { SPAWN_ROUTE } from '@/lib/spawn/spawnLinks';
import { SpawnAccountLink } from './SpawnAccountLink';
import styles from './spawn.module.css';

/**
 * Spawn's own chrome (`/spawn` is a no-chrome prefix in `shellRouting.ts`): the
 * Spawn mark, the page's sections, the account link, and a footer that says who
 * runs it and where the rules are. Every Spawn page renders inside it.
 */
export async function SpawnShell({ children }: { children: ReactNode }) {
  const t = await getTranslations('spawn.shell');
  return (
    <div className={styles.root}>
      <header className={styles.bar}>
        <Link href={SPAWN_ROUTE} className={styles.brand} aria-label={t('home')}>
          <span className={styles.brandMark} aria-hidden>⚡</span>
          Spawn
        </Link>
        <nav className={styles.nav} aria-label={t('navLabel')}>
          <Link href={`${SPAWN_ROUTE}#how`} className={styles.navLink}>{t('how')}</Link>
          <Link href={`${SPAWN_ROUTE}#safety`} className={styles.navLink}>{t('safety')}</Link>
          <Link href={`${SPAWN_ROUTE}#pricing`} className={styles.navLink}>{t('pricing')}</Link>
          <Link href={`${SPAWN_ROUTE}#download`} className={styles.navLink}>{t('download')}</Link>
          <SpawnAccountLink />
        </nav>
      </header>
      {children}
      <footer className={styles.footer}>
        <span>{t('madeBy')}</span>
        <span>
          <Link href="/legal">{t('terms')}</Link>
          {' · '}
          <Link href="/legal">{t('privacy')}</Link>
          {' · '}
          {t('notAffiliated')}
        </span>
      </footer>
    </div>
  );
}

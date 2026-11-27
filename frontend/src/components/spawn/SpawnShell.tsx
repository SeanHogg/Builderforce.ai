import type { ReactNode } from 'react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { BrandLockup } from '@/components/BrandLockup';
import { SPAWN_ROUTE } from '@/lib/spawn/spawnLinks';
import { SpawnAccountLink } from './SpawnAccountLink';
import { SpawnDownloadButton } from './SpawnDownloadButton';
import styles from './spawn.module.css';

/**
 * Spawn's own chrome (`/spawn` is a no-chrome prefix in `shellRouting.ts`). Spawn
 * is a Builderforce product and wears it: the bar is the Builderforce mark with
 * the Spawn wordmark and "by Builderforce", then the two things a visitor does —
 * sign in, download. The footer carries the Builderforce lockup home.
 */
export async function SpawnShell({ children }: { children: ReactNode }) {
  const t = await getTranslations('spawn.shell');
  return (
    <div className={styles.root}>
      <header className={styles.bar}>
        <BrandLockup href={SPAWN_ROUTE} label={t('home')} size={36} className={styles.brand}>
          <span className={styles.brandName}>Spawn</span>
          <span className={styles.brandBy}>{t('by')}</span>
        </BrandLockup>
        <div className={styles.barActions}>
          <SpawnAccountLink />
          <span className={styles.barDownload}><SpawnDownloadButton compact /></span>
        </div>
      </header>
      {children}
      <footer className={styles.footer}>
        <BrandLockup href="/" label={t('builderforce')} size={28} className={styles.footerBrand}>
          <span>{t('madeBy')}</span>
        </BrandLockup>
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

// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useTranslations } from 'next-intl';
import { SpawnDownloadButton } from './SpawnDownloadButton';
import styles from './spawn.module.css';

/** The last step: get the desktop app, which signs in to this same account. */
export function SpawnDesktopPanel({ ready }: { ready: boolean }) {
  const t = useTranslations('spawn.account.desktop');
  const steps = t.raw('steps') as string[];
  return (
    <section className={styles.panel} aria-labelledby="spawn-desktop-title">
      <div className={styles.row} style={{ justifyContent: 'space-between' }}>
        <h2 id="spawn-desktop-title" className={styles.cardTitle}>{t('title')}</h2>
        {ready && <span className={styles.statusOk}>{t('ready')}</span>}
      </div>
      <ol className={styles.cardBody} style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>
        {steps.map((step) => <li key={step}>{step}</li>)}
      </ol>
      <SpawnDownloadButton />
    </section>
  );
}

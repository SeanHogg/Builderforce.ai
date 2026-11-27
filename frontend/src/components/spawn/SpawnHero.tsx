import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { SPAWN_ACCOUNT_ROUTE } from '@/lib/spawn/spawnLinks';
import { SpawnDownloadButton } from './SpawnDownloadButton';
import { SpawnPlayground } from './SpawnPlayground';
import styles from './spawn.module.css';

/** "Say it. Spawn it." — one line, one big button, and a toy to tap instead of a paragraph to read. */
export async function SpawnHero() {
  const t = await getTranslations('spawn.hero');
  return (
    <section className={styles.hero} aria-labelledby="spawn-hero-title">
      <div className={styles.heroCopy}>
        <span className={styles.badge}>{t('badge')}</span>
        <h1 id="spawn-hero-title" className={styles.heroTitle}>
          {t('titleLead')} <span className={styles.heroAccent}>{t('titleAccent')}</span>
        </h1>
        <p className={styles.heroLede}>{t('lede')}</p>
        <SpawnDownloadButton />
        <div className={styles.ctaRow}>
          <Link href={SPAWN_ACCOUNT_ROUTE} className={styles.ctaGhost}>{t('start')}</Link>
          <span className={styles.fine}>{t('fine')}</span>
        </div>
      </div>
      <SpawnPlayground />
    </section>
  );
}

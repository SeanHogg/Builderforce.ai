import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { SPAWN_ACCOUNT_ROUTE, SPAWN_DOWNLOAD_URL } from '@/lib/spawn/spawnLinks';
import styles from './spawn.module.css';

/** The blocks of the hero's little obby — position and size in % of the scene. */
const SCENE: ReadonlyArray<{ left: number; bottom: number; width: number; height: number; color: string }> = [
  { left: 0, bottom: 0, width: 100, height: 14, color: 'var(--success)' },
  { left: 10, bottom: 14, width: 16, height: 8, color: 'var(--spawn-a)' },
  { left: 32, bottom: 26, width: 14, height: 8, color: 'var(--spawn-b)' },
  { left: 52, bottom: 38, width: 14, height: 8, color: 'var(--spawn-c)' },
  { left: 72, bottom: 50, width: 18, height: 8, color: 'var(--warning)' },
  { left: 80, bottom: 58, width: 4, height: 16, color: 'var(--text-primary)' },
];

/** "Say it. Spawn it." — the promise, the two ways in, and a picture of it working. */
export async function SpawnHero() {
  const t = await getTranslations('spawn.hero');
  return (
    <section className={styles.hero} aria-labelledby="spawn-hero-title">
      <div style={{ display: 'grid', gap: 20 }}>
        <p className={styles.eyebrow}>{t('eyebrow')}</p>
        <h1 id="spawn-hero-title" className={styles.heroTitle}>
          {t('titleLead')} <span className={styles.heroAccent}>{t('titleAccent')}</span>
        </h1>
        <p className={styles.lede}>{t('lede')}</p>
        <div className={styles.ctaRow}>
          <Link href={SPAWN_ACCOUNT_ROUTE} className={styles.cta}>{t('start')}</Link>
          <a href={SPAWN_DOWNLOAD_URL} className={styles.ctaGhost} target="_blank" rel="noopener noreferrer">{t('download')}</a>
        </div>
        <p className={styles.fine}>{t('fine')}</p>
      </div>
      <div className={styles.window} role="img" aria-label={t('pictureLabel')}>
        <div className={styles.windowChat}>
          <span className={styles.bubbleMe}>{t('chatAsk')}</span>
          <span className={styles.bubble}>{t('chatReply')}</span>
          <span className={styles.bubbleMe}>{t('chatAsk2')}</span>
        </div>
        <div className={styles.windowScene}>
          {SCENE.map((b, i) => (
            <span
              key={i}
              className={styles.block}
              style={{ left: `${b.left}%`, bottom: `${b.bottom}%`, width: `${b.width}%`, height: `${b.height}%`, background: b.color }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import PackageCard from '@/components/openSource/PackageCard';
import styles from '@/components/openSource/openSource.module.css';
import { OPEN_SOURCE_PACKAGES } from '@/lib/openSourcePackages';
import { pageMetadata } from '@/lib/seo';

/**
 * `/open-source` — the repositories Builderforce publishes under MIT, and why.
 *
 * Every package card is a projection of `OPEN_SOURCE_PACKAGES`; every word is
 * the `openSource` catalog. A Server Component end to end — nothing here is
 * interactive. Edge runtime because `getTranslations()` reads the locale cookie.
 */
export const runtime = 'edge';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('openSource.seo');
  return pageMetadata({
    title: t('title'),
    description: t('description'),
    path: '/open-source',
    ogTitle: t('ogTitle'),
  });
}

interface WhyPoint {
  title: string;
  desc: string;
}

export default async function OpenSourcePage() {
  const t = await getTranslations('openSource');
  const why = (t.raw('why.points') as WhyPoint[] | undefined) ?? [];

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <p className={styles.eyebrow}>{t('hero.eyebrow')}</p>
        <h1 className={styles.title}>{t('hero.title')}</h1>
        <p className={styles.lede}>{t('hero.subtitle')}</p>
      </header>

      <section className={styles.band} aria-labelledby="os-why">
        <h2 id="os-why" className={styles.sectionTitle}>{t('why.title')}</h2>
        <div className={styles.grid}>
          {why.map((point) => (
            <div key={point.title} className={styles.tile}>
              <h3 className={styles.tileTitle}>{point.title}</h3>
              <p className={styles.tileText}>{point.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.band} aria-labelledby="os-packages">
        <h2 id="os-packages" className={styles.sectionTitle}>{t('packagesTitle')}</h2>
        <p className={styles.body}>{t('packagesIntro')}</p>
        <div className={styles.grid}>
          {OPEN_SOURCE_PACKAGES.map((entry) => <PackageCard key={entry.slug} entry={entry} />)}
        </div>
      </section>

      <section className={styles.cta}>
        <div className={styles.ctaBox}>
          <h2 className={styles.sectionTitle}>{t('cta.title')}</h2>
          <p className={styles.body}>{t('cta.desc')}</p>
          <div className={styles.ctaActions}>
            <Link className={styles.btnPrimary} href="/create/new">{t('cta.primary')}</Link>
            <Link className={styles.btnSecondary} href="/blog">{t('cta.secondary')}</Link>
          </div>
        </div>
      </section>
    </main>
  );
}

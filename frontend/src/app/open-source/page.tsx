import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import JsonLd from '@/components/JsonLd';
import RelatedArticles from '@/components/blog/RelatedArticles';
import { CreationCtaSection } from '@/components/marketing/CreationCtaSection';
import PackageCard from '@/components/openSource/PackageCard';
import styles from '@/components/openSource/openSource.module.css';
import { OPEN_SOURCE_PACKAGES } from '@/lib/openSourcePackages';
import { pageMetadata } from '@/lib/seo';
import { openSourceIndexSchema } from '@/lib/openSourceSchema';

/**
 * `/open-source` — the repositories Builderforce publishes under MIT, and why.
 *
 * Every package card is a projection of `OPEN_SOURCE_PACKAGES`; every word is
 * the `openSource` catalog. The page is a Server Component; the related-reading
 * cards and the closing ask are the shared marketing primitives
 * (`RelatedArticles`, `CreationCtaSection`). Edge runtime because
 * `getTranslations()` reads the locale cookie.
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
  const root = await getTranslations();
  const t = await getTranslations('openSource');
  const why = (t.raw('why.points') as WhyPoint[] | undefined) ?? [];

  return (
    <main className={styles.page}>
      <JsonLd data={openSourceIndexSchema(root)} />
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

      {/* The article behind each package; RelatedArticles skips any slug that is
          not in the blog index. */}
      <RelatedArticles slugs={OPEN_SOURCE_PACKAGES.flatMap((entry) => (entry.relatedBlogSlug ? [entry.relatedBlogSlug] : []))} />

      <CreationCtaSection />
    </main>
  );
}

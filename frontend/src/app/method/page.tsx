import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import JsonLd from '@/components/JsonLd';
import MethodologySection from '@/components/marketing/MethodologySection';
import RelatedArticles from '@/components/blog/RelatedArticles';
import styles from './Method.module.css';

export const runtime = 'edge';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('method');
  return {
    title: t('seo.title'),
    description: t('seo.description'),
    alternates: { canonical: 'https://builderforce.ai/method' },
    openGraph: {
      title: t('seo.title'),
      description: t('seo.description'),
      url: 'https://builderforce.ai/method',
      type: 'website',
    },
  };
}

/**
 * `/method` — "Idea to Real", named as its own page.
 *
 * The method already had four retellings (`/features`, `/about`, `/pricing`,
 * `/sell-builderforce`), each carrying `<MethodologySection>` alongside a
 * different pitch. None of them was the page you'd actually LINK someone who
 * asked "how does this work?" — this is that page: the method and nothing
 * else, `variant="full"` (loop + arc + all eight proofs), the same component
 * the other four render so a fifth retelling cannot drift from it.
 */
export default async function MethodPage() {
  const t = await getTranslations('method');

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    name: t('seo.title'),
    description: t('seo.description'),
    url: 'https://builderforce.ai/method',
  };

  return (
    <main className={styles.page}>
      <JsonLd data={schema} />

      <section className={styles.hero}>
        <p className={styles.eyebrow}>{t('hero.eyebrow')}</p>
        <h1>{t('hero.title')}</h1>
        <p className={styles.lede}>{t('hero.lead')}</p>
        <div className={styles.actions}>
          <Link className={styles.primaryButton} href="/register">{t('hero.primaryCta')} <span aria-hidden="true">→</span></Link>
          <Link className={styles.secondaryButton} href="/features">{t('hero.secondaryCta')}</Link>
        </div>
      </section>

      <section className={styles.method}>
        <MethodologySection variant="full" headingLevel="h2" />
        <RelatedArticles surface="methodology" embedded />
      </section>

      <section className={styles.cta}>
        <p className={styles.eyebrow}>{t('cta.eyebrow')}</p>
        <h2>{t('cta.title')}</h2>
        <p>{t('cta.body')}</p>
        <div className={styles.actions}>
          <Link className={styles.primaryButton} href="/register">{t('cta.primary')} <span aria-hidden="true">→</span></Link>
        </div>
      </section>
    </main>
  );
}

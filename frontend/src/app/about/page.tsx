import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import JsonLd from '@/components/JsonLd';
import MethodologySection from '@/components/marketing/MethodologySection';
import RelatedArticles from '@/components/blog/RelatedArticles';
import { Icon } from '@/components/ui/Icon';
import { REFERENCE_DOMAINS, REFERENCE_FOUNDATIONS } from '@/lib/publicDestinations';
import styles from './AboutPage.module.css';

export const runtime = 'edge';

type PromiseCopy = { title: string; description: string };
type PrincipleCopy = { title: string; description: string };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('about');
  return {
    title: t('seo.title'),
    description: t('seo.description'),
    alternates: { canonical: 'https://builderforce.ai/about' },
    openGraph: {
      title: t('seo.title'),
      description: t('seo.description'),
      url: 'https://builderforce.ai/about',
      type: 'website',
    },
  };
}

export default async function AboutPage() {
  const t = await getTranslations('about');
  const tb = await getTranslations('burnrateMarketing');
  const promises = t.raw('promises.items') as PromiseCopy[];
  const principles = t.raw('principles.items') as PrincipleCopy[];

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    name: t('seo.title'),
    description: t('seo.description'),
    url: 'https://builderforce.ai/about',
    mainEntity: {
      '@type': 'Organization',
      name: 'Builderforce.ai',
      url: 'https://builderforce.ai',
    },
  };

  return (
    <main className={styles.page}>
      <JsonLd data={schema} />

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>{t('hero.eyebrow')}</p>
          <h1>{t('hero.title')}</h1>
          <p className={styles.lede}>{t('hero.lead')}</p>
          <div className={styles.actions}>
            <Link className={styles.primaryButton} href="/register">{t('hero.primaryCta')} <span aria-hidden="true">→</span></Link>
            <Link className={styles.secondaryButton} href="/book-demo">{t('hero.secondaryCta')}</Link>
          </div>
          <div className={styles.metrics}>
            <div><strong>9</strong><span>{t('hero.domains')}</span></div>
            <div><strong>3</strong><span>{t('hero.foundations')}</span></div>
            <div><strong>1</strong><span>{t('hero.workspace')}</span></div>
          </div>
        </div>

        <div className={styles.systemVisual} aria-label={t('hero.visualAria')}>
          <div className={styles.orbit} aria-hidden="true" />
          <div className={styles.core}>
            <span>Builderforce</span>
            <strong>{t('hero.core')}</strong>
          </div>
          <div className={`${styles.satellite} ${styles.satelliteProduct}`}><Icon source="📦" size={22} /><span>{tb('domains.productManagement.title')}</span></div>
          <div className={`${styles.satellite} ${styles.satelliteFinance}`}><Icon source="📊" size={22} /><span>{tb('domains.businessIntelligence.title')}</span></div>
          <div className={`${styles.satellite} ${styles.satelliteGrowth}`}><Icon source="📈" size={22} /><span>{tb('domains.salesRevenue.title')}</span></div>
          <div className={`${styles.satellite} ${styles.satelliteSecurity}`}><Icon source="🛡" size={22} /><span>{tb('domains.governanceSecurity.title')}</span></div>
        </div>
      </section>

      <section className={styles.thesis}>
        <p className={styles.eyebrow}>{t('thesis.eyebrow')}</p>
        <div>
          <h2>{t('thesis.title')}</h2>
          <p>{t('thesis.body')}</p>
        </div>
      </section>

      {/* The thesis above says a company is a system. This says how the system
          is actually worked — the same component /features, /pricing and
          /sell-builderforce render, so "what Builderforce does" has one answer
          across the site instead of four. `full`: nothing else on this page
          states the arc or the proof ladder. */}
      <section className={styles.method}>
        <MethodologySection variant="full" />
        <RelatedArticles surface="methodology" embedded />
      </section>

      <section className={styles.promises}>
        <header className={styles.sectionHeader}>
          <p className={styles.eyebrow}>{t('promises.eyebrow')}</p>
          <h2>{t('promises.title')}</h2>
        </header>
        <div className={styles.promiseGrid}>
          {promises.map((promise, index) => (
            <article key={promise.title}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <h3>{promise.title}</h3>
              <p>{promise.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.system}>
        <header className={styles.sectionHeader}>
          <p className={styles.eyebrow}>{t('system.eyebrow')}</p>
          <h2>{t('system.title')}</h2>
          <p>{t('system.lead')}</p>
        </header>

        <div className={styles.domainGroup}>
          <div className={styles.groupHeading}><h3>{t('system.domains')}</h3><span>9</span></div>
          <div className={styles.domainGrid}>
            {REFERENCE_DOMAINS.map((domain) => (
              <Link href={domain.marketingHref} key={domain.id} className={styles.domainCard}>
                <span className={styles.domainIcon}><Icon source={domain.icon} size={22} /></span>
                <span><small>{domain.seat}</small><strong>{tb(`domains.${domain.copyId}.title`)}</strong><em>{tb(`domains.${domain.copyId}.tagline`)}</em></span>
                <b aria-hidden="true">↗</b>
              </Link>
            ))}
          </div>
        </div>

        <div className={styles.domainGroup}>
          <div className={styles.groupHeading}><h3>{t('system.foundations')}</h3><span>3</span></div>
          <div className={`${styles.domainGrid} ${styles.foundationGrid}`}>
            {REFERENCE_FOUNDATIONS.map((domain) => (
              <Link href={domain.marketingHref} key={domain.id} className={styles.domainCard}>
                <span className={styles.domainIcon}><Icon source={domain.icon} size={22} /></span>
                <span><small>{domain.seat}</small><strong>{tb(`domains.${domain.copyId}.title`)}</strong><em>{tb(`domains.${domain.copyId}.tagline`)}</em></span>
                <b aria-hidden="true">↗</b>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.story}>
        <div className={styles.storyLabel}>
          <p className={styles.eyebrow}>{t('story.eyebrow')}</p>
          <h2>{t('story.title')}</h2>
        </div>
        <div className={styles.storyCopy}>
          <p>{t('story.bodyOne')}</p>
          <p>{t('story.bodyTwo')}</p>
        </div>
      </section>

      <section className={styles.principles}>
        <header className={styles.sectionHeader}>
          <p className={styles.eyebrow}>{t('principles.eyebrow')}</p>
          <h2>{t('principles.title')}</h2>
        </header>
        <div className={styles.principleGrid}>
          {principles.map((principle) => (
            <article key={principle.title}><h3>{principle.title}</h3><p>{principle.description}</p></article>
          ))}
        </div>
      </section>

      <section className={styles.trust}>
        <div>
          <p className={styles.eyebrow}>{t('trust.eyebrow')}</p>
          <h2>{t('trust.title')}</h2>
          <p>{t('trust.body')}</p>
        </div>
        <Link href="/soc2">{t('trust.cta')} <span aria-hidden="true">→</span></Link>
      </section>

      <section className={styles.cta}>
        <p className={styles.eyebrow}>{t('cta.eyebrow')}</p>
        <h2>{t('cta.title')}</h2>
        <p>{t('cta.body')}</p>
        <div className={styles.actions}>
          <Link className={styles.primaryButton} href="/register">{t('cta.primary')} <span aria-hidden="true">→</span></Link>
          <Link className={styles.secondaryButton} href="/features">{t('cta.secondary')}</Link>
        </div>
      </section>
    </main>
  );
}

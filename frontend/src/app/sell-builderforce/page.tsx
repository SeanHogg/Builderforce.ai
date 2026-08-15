import { Icon } from '@/components/ui/Icon';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import JsonLd from '@/components/JsonLd';
import MethodologySection from '@/components/marketing/MethodologySection';
import { BRAND } from '@/lib/content';
import { pageMetadata } from '@/lib/seo';
import styles from './sell-builderforce.module.css';
import { signInHref } from '@/lib/auth';

export const runtime = 'edge';

/**
 * `/sell-builderforce` — the referral and sales-associate programme.
 *
 * Two things were wrong with it and they were the same thing. Every string was
 * hardcoded English, so the one public page whose entire job is to be forwarded
 * to somebody was the one page that could not be read in four of the five
 * languages the rest of the site ships. And it sold a TOOLKIT — a canvas, a
 * CRM, some campaigns — to people whose hardest objection is "we already have
 * AI tools", which a longer feature list does not answer.
 *
 * So the method is on the page now, rendered by the same component `/features`,
 * `/about` and `/pricing` use. An associate pitching Builderforce and a
 * prospect reading about it are then looking at the same sentence, which is the
 * only version of sales enablement that survives contact with a real call.
 */

/** Capability cards: the copy is in the catalogs, the ORDER is here. */
const CAPABILITY_IDS = ['canvas', 'crm', 'targeting', 'campaigns', 'goals', 'meetings'] as const;

/** Downloadables. The href is the only non-translatable part of a material. */
const MATERIALS = [
  { id: 'discovery', href: '/media/sales/Builderforce-Sales-Discovery-Guide.html' },
  { id: 'outbound', href: '/media/sales/Builderforce-Outbound-Playbook.html' },
  { id: 'contacts', href: '/media/sales/Builderforce-Contacts-Template.csv' },
] as const;

const STEP_IDS = ['one', 'two', 'three'] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('sell.seo');
  return pageMetadata({
    title: t('title'),
    description: t('description'),
    path: '/sell-builderforce',
    ogTitle: t('ogTitle'),
  });
}

export default async function SellBuilderforcePage() {
  const t = await getTranslations('sell');
  const tSeo = await getTranslations('sell.seo');

  const programSchema = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: 'Builderforce Referral & Sales Associate Program',
    description: tSeo('description'),
    provider: { '@type': 'Organization', name: BRAND.name, url: BRAND.url },
    url: `${BRAND.url}/sell-builderforce`,
  };

  return (
    <main className={styles.page}>
      <JsonLd data={programSchema} />

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>{t('hero.eyebrow')}</p>
          <h1>{t('hero.titleLine1')}<br />{t('hero.titleLine2')}</h1>
          <p className={styles.lede}>{t('hero.lede')}</p>
          <div className={styles.actions}>
            <Link className={styles.primaryButton} href="/register?role=sales&next=/sales">{t('hero.primaryCta')}</Link>
            <Link className={styles.secondaryButton} href={signInHref('/sales')}>{t('hero.secondaryCta')}</Link>
          </div>
          <p className={styles.finePrint}>{t('hero.finePrint')}</p>
        </div>
        <div className={styles.heroPanel} aria-label={t('heroPanel.aria')}>
          <span className={styles.status}><i /> {t('heroPanel.status')}</span>
          <h2>{t('heroPanel.title')}</h2>
          <div className={styles.metricRow}>
            <div><small>{t('heroPanel.pipelineLabel')}</small><strong>{t('heroPanel.pipelineValue')}</strong></div>
            <div><small>{t('heroPanel.goalsLabel')}</small><strong>{t('heroPanel.goalsValue')}</strong></div>
          </div>
          <ul>
            <li><span>01</span>{t('heroPanel.step1')}</li>
            <li><span>02</span>{t('heroPanel.step2')}</li>
            <li><span>03</span>{t('heroPanel.step3')}</li>
            <li><span>04</span>{t('heroPanel.step4')}</li>
          </ul>
        </div>
      </section>

      {/* What an associate is actually selling. The method comes before the
          toolkit because the toolkit is the answer to a question the prospect
          has not asked yet. */}
      <section className={styles.methodSection}>
        <p className={styles.eyebrow}>{t('pitch.eyebrow')}</p>
        <h2>{t('pitch.title')}</h2>
        <p className={styles.sectionIntro}>{t('pitch.body')}</p>
        <MethodologySection variant="loop" headingLevel="h3" />
      </section>

      <section className={styles.section}>
        <p className={styles.eyebrow}>{t('capabilities.eyebrow')}</p>
        <h2>{t('capabilities.title')}</h2>
        <p className={styles.sectionIntro}>{t('capabilities.intro')}</p>
        <div className={styles.capabilityGrid}>
          {CAPABILITY_IDS.map((id, index) => (
            <article key={id} className={styles.capabilityCard}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <h3>{t(`capabilities.items.${id}.title`)}</h3>
              <p>{t(`capabilities.items.${id}.text`)}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.splitSection}>
        <div>
          <p className={styles.eyebrow}>{t('visibility.eyebrow')}</p>
          <h2>{t('visibility.title')}</h2>
          <p>{t('visibility.body')}</p>
        </div>
        <div className={styles.checkList}>
          {(['check1', 'check2', 'check3', 'check4'] as const).map((key) => (
            <p key={key}><span><Icon source="✓" size="1em" /></span> {t(`visibility.${key}`)}</p>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <p className={styles.eyebrow}>{t('materials.eyebrow')}</p>
        <h2>{t('materials.title')}</h2>
        <p className={styles.sectionIntro}>
          {t.rich('materials.intro', {
            media: (chunks) => <Link href="/media">{chunks}</Link>,
          })}
        </p>
        <div className={styles.materialGrid}>
          {MATERIALS.map((material) => (
            <a key={material.href} className={styles.materialCard} href={material.href} download>
              <span>{t(`materials.items.${material.id}.label`)}</span>
              <h3>{t(`materials.items.${material.id}.title`)}</h3>
              <p>{t(`materials.items.${material.id}.text`)}</p>
              <strong>{t('materials.download')}</strong>
            </a>
          ))}
        </div>
      </section>

      <section className={styles.stepsSection}>
        <p className={styles.eyebrow}>{t('steps.eyebrow')}</p>
        <div className={styles.steps}>
          {STEP_IDS.map((id, index) => (
            <article key={id}>
              <b>{index + 1}</b>
              <div>
                <h3>{t(`steps.${id}.title`)}</h3>
                <p>{t(`steps.${id}.text`)}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.cta}>
        <div><p className={styles.eyebrow}>{t('cta.eyebrow')}</p><h2>{t('cta.title')}</h2></div>
        <Link className={styles.primaryButton} href="/register?role=sales&next=/sales">{t('cta.button')}</Link>
      </section>
    </main>
  );
}

'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import JsonLd from '@/components/JsonLd';
import { homepageSchema } from '@/lib/structured-data';
import { FEATURES, STATS, WORKFLOW_PROOF_DEMOS } from '@/lib/content';
import { BLOG_POSTS } from '@/lib/blogData';
import { ArticleCardGrid } from '@/components/blog/ArticleCard';
import QuickStart from '@/components/QuickStart';
import { DemoShowcase } from '@/components/demo/DemoShowcase';
import { AUTH_API_URL } from '@/lib/auth';
import { LandingCanvasHero } from '@/components/home/LandingCanvasHero';
import { MeetCarousel } from '@/components/home/MeetCarousel';
import {
  Badge,
  BadgeRow,
  CardIcon,
  CardText,
  CardTitle,
  HomeButton,
  HomeCard,
  HomeGrid,
  HomeSection,
  HomeSectionHeader,
  homePatternStyles as styles,
} from '@/components/home/HomePatterns';

type TitleDesc = { title: string; desc: string };
type StatLabel = { label: string };
type FaqItem = { question: string; answer: string };
type PricingTeaser = { name: string; perks: string[] };
type WorkflowProofCopy = { title: string; audience: string; outcome: string; steps: string[]; evidence: string };

export default function LandingPage() {
  const t = useTranslations();
  const [nlEmail, setNlEmail] = useState('');
  const [nlStatus, setNlStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle');
  const [publicPlanPrices, setPublicPlanPrices] = useState<{ pro: number } | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`${AUTH_API_URL}/api/tenants/pricing`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`${response.status}`)))
      .then((contract: { pricing: { pro: { monthly: number } } }) => {
        if (active) setPublicPlanPrices({ pro: contract.pricing.pro.monthly });
      })
      .catch(() => { /* Pricing CTA remains available; never invent a fallback price. */ });
    return () => { active = false; };
  }, []);

  async function handleNewsletterSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!nlEmail.trim()) return;
    setNlStatus('sending');
    try {
      const response = await fetch('/api/auth/newsletter/subscribers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: nlEmail.trim(), action: 'subscribe', source: 'builderforce-landing' }),
      });
      if (!response.ok) throw new Error('subscribe failed');
      setNlStatus('ok');
    } catch {
      setNlStatus('error');
    }
  }

  return (
    <>
      <JsonLd data={homepageSchema()} />
      <main>
        <LandingCanvasHero />
        <MeetCarousel />
        <QuickStart />

        <div className={styles.statBand}>
          {(t.raw('home.stats') as StatLabel[]).map((stat, index) => (
            <div key={stat.label} className={styles.stat}>
              <div className={styles.statValue}>{STATS.marketing[index]?.value}</div>
              <div className={styles.statLabel} style={{ whiteSpace: 'pre-line' }}>{stat.label}</div>
            </div>
          ))}
        </div>

        <HomeSection id="workflow-proof" tone="soft">
          <HomeSectionHeader
            eyebrow="01"
            title={t('home.workflowProof.heading')}
            lead={t('home.workflowProof.lead')}
          />
          <HomeGrid columns={3}>
            {(t.raw('home.workflowProof.demos') as WorkflowProofCopy[]).map((demo, index) => {
              const proof = WORKFLOW_PROOF_DEMOS[index];
              return (
                <HomeCard key={proof?.id ?? demo.title}>
                  <BadgeRow>
                    <Badge accent>{t('product.capabilityStatus.beta')}</Badge>
                    <Badge>{t(`product.dataBoundary.${proof?.dataBoundary ?? 'hybrid'}`)}</Badge>
                  </BadgeRow>
                  <CardTitle>{demo.title}</CardTitle>
                  <CardText><strong>{demo.audience}</strong> — {demo.outcome}</CardText>
                  <ol className={styles.steps}>{demo.steps.map((step) => <li key={step}>{step}</li>)}</ol>
                  <p className={styles.evidence}>{demo.evidence}</p>
                </HomeCard>
              );
            })}
          </HomeGrid>
          <div className={styles.actions}><HomeButton href="/product#workflow-proof" arrow>{t('home.workflowProof.cta')}</HomeButton></div>
        </HomeSection>

        <HomeSection tone="grid">
          <HomeSectionHeader centered eyebrow="02" title={t('compare.teaser.title')} lead={t('compare.teaser.blurb')} />
          <HomeGrid columns={3}>
            {(t.raw('compare.teaser.highlightFeatures') as string[]).map((feature, index) => (
              <HomeCard key={feature}>
                <CardIcon>{String(index + 1).padStart(2, '0')}</CardIcon>
                <CardText>{feature}</CardText>
              </HomeCard>
            ))}
          </HomeGrid>
          <div className={`${styles.actions} ${styles.actionsCenter}`}>
            <HomeButton href="/compare" primary arrow>{t('compare.teaser.ctaLabel')}</HomeButton>
          </div>
        </HomeSection>

        <HomeSection>
          <HomeSectionHeader eyebrow="03" title={t('home.stepsHeading')} />
          <HomeGrid columns={3}>
            {(t.raw('home.steps') as TitleDesc[]).map((step, index) => (
              <HomeCard key={step.title} className={styles.numberCard}>
                <span className={styles.number}>{String(index + 1).padStart(2, '0')} / 03</span>
                <CardTitle>{step.title}</CardTitle>
                <CardText>{step.desc}</CardText>
              </HomeCard>
            ))}
          </HomeGrid>
        </HomeSection>

        <DemoShowcase />

        <HomeSection id="features" tone="soft">
          <HomeSectionHeader eyebrow="04" title={t('home.featuresHeading')} />
          <HomeGrid columns={4}>
            {(t.raw('features') as { title: string; longDesc: string }[]).map((feature, index) => (
              <HomeCard key={feature.title}>
                <CardIcon>{String(index + 1).padStart(2, '0')}</CardIcon>
                <CardTitle>{feature.title}</CardTitle>
                <CardText>{feature.longDesc}</CardText>
              </HomeCard>
            ))}
          </HomeGrid>
        </HomeSection>

        <HomeSection id="pricing">
          <HomeSectionHeader eyebrow="05" title={t('home.pricingHeading')} />
          <HomeGrid columns={2}>
            {(t.raw('home.pricingTeaser') as PricingTeaser[]).map((plan, index) => (
              <HomeCard key={plan.name}>
                <Badge accent>{index === 0 ? '01' : '02'}</Badge>
                <div style={{ marginTop: 24 }}><CardTitle>{plan.name}</CardTitle></div>
                <div className={styles.price}>
                  {index === 0 ? '$0' : publicPlanPrices
                    ? `$${publicPlanPrices.pro}${t('home.pricePerSeat')}`
                    : <Link href="/pricing">{t('home.currentPricing')}</Link>}
                </div>
                <ul className={styles.perks}>{plan.perks.map((perk) => <li className={styles.perk} key={perk}>{perk}</li>)}</ul>
              </HomeCard>
            ))}
          </HomeGrid>
        </HomeSection>

        <HomeSection id="blog" tone="soft">
          <HomeSectionHeader centered eyebrow="06" title={t('home.blogHeading')} lead={t('home.blogLead')} />
          <ArticleCardGrid posts={BLOG_POSTS} limit={3} />
          <div className={`${styles.actions} ${styles.actionsCenter}`}>
            <HomeButton href="/blog" arrow>{t('home.blogReadAll')}</HomeButton>
          </div>
        </HomeSection>

        <HomeSection narrow>
          <HomeSectionHeader centered eyebrow="07" title={t('home.newsletterHeading')} lead={t('home.newsletterLead')} />
          <form onSubmit={handleNewsletterSubmit} className={styles.form}>
            <input
              className={styles.input}
              type="email"
              placeholder={t('home.newsletterPlaceholder')}
              aria-label={t('home.newsletterPlaceholder')}
              required
              value={nlEmail}
              onChange={(event) => setNlEmail(event.target.value)}
              disabled={nlStatus === 'sending' || nlStatus === 'ok'}
            />
            <button type="submit" disabled={nlStatus === 'sending' || nlStatus === 'ok'} className={`${styles.button} ${styles.buttonPrimary}`}>
              {nlStatus === 'sending' ? t('home.newsletterSubscribing') : nlStatus === 'ok' ? t('home.newsletterSubscribed') : t('home.newsletterSubscribe')}
            </button>
          </form>
          {nlStatus === 'ok' && <p className={styles.formStatus}>{t('home.newsletterSubscribedConfirm')}</p>}
          {nlStatus === 'error' && <p className={`${styles.formStatus} ${styles.formError}`}>{t('home.newsletterError')}</p>}
        </HomeSection>

        <HomeSection narrow tone="soft">
          <HomeSectionHeader centered eyebrow="08" title={t('home.faqHeading')} />
          <div className={styles.faq}>
            {(t.raw('home.faq') as FaqItem[]).map((faq) => (
              <details className={styles.faqItem} key={faq.question}>
                <summary>{faq.question}</summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </HomeSection>

        <HomeSection tone="grid">
          <div className={styles.cta}>
            <HomeSectionHeader title={t('home.ctaTitle')} lead={t('home.ctaDesc')} />
            <div className={styles.actions}>
              <HomeButton href="/register" primary arrow>{t('marketing.ctaGetStartedFree')}</HomeButton>
              <HomeButton href="/creation-canvas" arrow>{t('home.ctaSeeLiveAgents')}</HomeButton>
            </div>
          </div>
        </HomeSection>
      </main>
    </>
  );
}

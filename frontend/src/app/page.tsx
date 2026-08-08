'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import JsonLd from '@/components/JsonLd';
import { homepageSchema } from '@/lib/structured-data';
import { STATS } from '@/lib/content';
import { BLOG_POSTS } from '@/lib/blogData';
import { ArticleCardGrid } from '@/components/blog/ArticleCard';
import QuickStart from '@/components/QuickStart';
import { DemoShowcase } from '@/components/demo/DemoShowcase';
import { AUTH_API_URL } from '@/lib/auth';
import { LandingCanvasHero } from '@/components/home/LandingCanvasHero';
import { MeetCarousel } from '@/components/home/MeetCarousel';
import { TensionBeat } from '@/components/home/TensionBeat';
import { Button } from '@/components/ui';
import {
  HomeScrollerControls,
  HomeScrollerItem,
  HomeScrollerRail,
  useHomeScroller,
} from '@/components/home/HomeScroller';
import {
  CardText,
  CardTitle,
  HomeButton,
  HomeCard,
  HomeGrid,
  HomeSection,
  HomeSectionHeader,
  homePatternStyles as styles,
} from '@/components/home/HomePatterns';

type StatLabel = { label: string };
type FaqItem = { question: string; answer: string };
type PricingTeaser = { name: string; perks: string[] };

/**
 * The homepage is one argument, told in order.
 *
 * It previously ran as an inventory: eight sections labelled 01…08 — proof,
 * compare, steps, features, pricing, blog, newsletter, FAQ — each rendered as
 * the same card grid, with a SECOND set of numbers (01/02/03) decorating the
 * cards inside them. Nothing in that ordering was a sequence, so the numbering
 * announced a structure the content did not have, and eight identical grids gave
 * the reader no sense of moving through anything.
 *
 * The order below is a narrative: start on the canvas → name the problem and
 * resolve it into a workflow → see what it is → watch it work → see the evidence → see the breadth → see why not
 * the alternatives → price → objections → act. Section eyebrows now name the BEAT they carry.
 * Numbering survives in exactly one place, "How it works", because those three
 * steps genuinely are a sequence.
 *
 * Treatment varies with the job: an argument is a grid, a catalogue is a rail
 * ({@link HomeScrollerRail}), evidence is a stat band. Secondary material
 * (writing, newsletter) sits BELOW the primary call to action rather than
 * between the reader and it.
 */
export default function LandingPage() {
  const t = useTranslations();
  const [nlEmail, setNlEmail] = useState('');
  const [nlStatus, setNlStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle');
  const [publicPlanPrices, setPublicPlanPrices] = useState<{ pro: number } | null>(null);
  const capabilityScroller = useHomeScroller();

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
        {/* 1 · START — the board itself, with a composer. The product argues for
            itself before a word of description. */}
        <LandingCanvasHero />

        {/* 2 · PROBLEM → WORKFLOW — the fragmented-tool tension and the
            three-step answer are one argument, not two disconnected sections. */}
        <TensionBeat />

        {/* 3 · WHAT IT IS — the rotating Create → Evermind → governed-delivery story. */}
        <MeetCarousel />

        <QuickStart />

        {/* 5 · SEE IT RUN */}
        <DemoShowcase />

        {/* 6 · EVIDENCE — the live showcase, then the numbers. The stat band used to
            open the page, before the reader had any reason to care what the
            numbers counted; it lands here instead, as the payoff of the proof. */}
        <div className={styles.statBand}>
          {(t.raw('home.stats') as StatLabel[]).map((stat, index) => (
            <div key={stat.label} className={styles.stat}>
              <div className={styles.statValue}>{STATS.marketing[index]?.value}</div>
              <div className={styles.statLabel} style={{ whiteSpace: 'pre-line' }}>{stat.label}</div>
            </div>
          ))}
        </div>

        {/* 7 · BREADTH — a catalogue, so a rail rather than a wall of nine dense
            paragraphs in four columns. */}
        <HomeSection id="features" tone="soft">
          <HomeSectionHeader
            eyebrow={t('home.beat.breadth')}
            title={t('home.featuresHeading')}
            lead={t('home.featuresLead')}
            aside={<HomeScrollerControls scroller={capabilityScroller} />}
          />
          <HomeScrollerRail scroller={capabilityScroller} label={t('home.featuresHeading')}>
            {(t.raw('features') as { title: string; longDesc: string }[]).map((feature) => (
              <HomeScrollerItem key={feature.title}>
                <HomeCard>
                  <CardTitle>{feature.title}</CardTitle>
                  <CardText>{feature.longDesc}</CardText>
                </HomeCard>
              </HomeScrollerItem>
            ))}
          </HomeScrollerRail>
        </HomeSection>

        {/* 8 · WHY NOT THE ALTERNATIVES */}
        <HomeSection tone="grid">
          <HomeSectionHeader centered eyebrow={t('home.beat.compare')} title={t('compare.teaser.title')} lead={t('compare.teaser.blurb')} />
          <HomeGrid columns={3}>
            {(t.raw('compare.teaser.highlightFeatures') as string[]).map((feature) => (
              <HomeCard key={feature}>
                <CardText>{feature}</CardText>
              </HomeCard>
            ))}
          </HomeGrid>
          <div className={`${styles.actions} ${styles.actionsCenter}`}>
            <HomeButton href="/compare" primary arrow>{t('compare.teaser.ctaLabel')}</HomeButton>
          </div>
        </HomeSection>

        {/* 9 · WHAT IT COSTS */}
        <HomeSection id="pricing">
          <HomeSectionHeader eyebrow={t('home.beat.pricing')} title={t('home.pricingHeading')} />
          <HomeGrid columns={2}>
            {(t.raw('home.pricingTeaser') as PricingTeaser[]).map((plan, index) => (
              <HomeCard key={plan.name}>
                <CardTitle>{plan.name}</CardTitle>
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

        {/* 10 · OBJECTIONS — answered immediately before the ask, which is where
            they actually surface. */}
        <HomeSection narrow tone="soft">
          <HomeSectionHeader centered eyebrow={t('home.beat.questions')} title={t('home.faqHeading')} />
          <div className={styles.faq}>
            {(t.raw('home.faq') as FaqItem[]).map((faq) => (
              <details className={styles.faqItem} key={faq.question}>
                <summary>{faq.question}</summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </HomeSection>

        {/* 11 · THE ASK */}
        <HomeSection tone="grid">
          <div className={styles.cta}>
            <HomeSectionHeader title={t('home.ctaTitle')} lead={t('home.ctaDesc')} />
            <div className={styles.actions}>
              <HomeButton href="/register" primary arrow>{t('marketing.ctaGetStartedFree')}</HomeButton>
              <HomeButton href="/creation-canvas" arrow>{t('home.ctaSeeLiveAgents')}</HomeButton>
            </div>
          </div>
        </HomeSection>

        {/* Secondary. Below the ask on purpose — these used to sit between the
            reader and the call to action. They stay on the page for the crawler
            and for the visitor who wants depth before deciding. */}
        <HomeSection id="blog">
          <HomeSectionHeader centered eyebrow={t('home.beat.writing')} title={t('home.blogHeading')} lead={t('home.blogLead')} />
          <ArticleCardGrid posts={BLOG_POSTS} limit={3} />
          <div className={`${styles.actions} ${styles.actionsCenter}`}>
            <HomeButton href="/blog" arrow>{t('home.blogReadAll')}</HomeButton>
          </div>
        </HomeSection>

        <HomeSection narrow tone="soft">
          <HomeSectionHeader centered eyebrow={t('home.beat.keepUp')} title={t('home.newsletterHeading')} lead={t('home.newsletterLead')} />
          <form onSubmit={handleNewsletterSubmit} className={styles.form}>
            <input
              className="ui-input"
              type="email"
              placeholder={t('home.newsletterPlaceholder')}
              aria-label={t('home.newsletterPlaceholder')}
              required
              value={nlEmail}
              onChange={(event) => setNlEmail(event.target.value)}
              disabled={nlStatus === 'sending' || nlStatus === 'ok'}
            />
            <Button type="submit" disabled={nlStatus === 'sending' || nlStatus === 'ok'} variant="primary" size="lg">
              {nlStatus === 'sending' ? t('home.newsletterSubscribing') : nlStatus === 'ok' ? t('home.newsletterSubscribed') : t('home.newsletterSubscribe')}
            </Button>
          </form>
          {nlStatus === 'ok' && <p className={styles.formStatus}>{t('home.newsletterSubscribedConfirm')}</p>}
          {nlStatus === 'error' && <p className={`${styles.formStatus} ${styles.formError}`}>{t('home.newsletterError')}</p>}
        </HomeSection>
      </main>
    </>
  );
}

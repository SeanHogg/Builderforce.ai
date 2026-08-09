'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import JsonLd from '@/components/JsonLd';
import { homepageSchema } from '@/lib/structured-data';
import { STATS } from '@/lib/content';
import QuickStart from '@/components/QuickStart';
import { DemoShowcase } from '@/components/demo/DemoShowcase';
import { AUTH_API_URL } from '@/lib/auth';
import { LandingCanvasHero } from '@/components/home/LandingCanvasHero';
import { MeetCarousel } from '@/components/home/MeetCarousel';
import { TensionBeat } from '@/components/home/TensionBeat';
import { CreationCtaSection } from '@/components/marketing/CreationCtaSection';
import { LatestBlogSection } from '@/components/marketing/LatestBlogSection';
import { NewsletterSignupSection } from '@/components/marketing/NewsletterSignupSection';
import {
  CardTitle,
  HomeButton,
  HomeCard,
  HomeSection,
  HomeSectionHeader,
  homePatternStyles as styles,
} from '@/components/home/HomePatterns';

type StatLabel = { label: string };
type FaqItem = { question: string; answer: string };
type PricingTeaser = {
  id: 'free' | 'pro' | 'teams';
  name: string;
  perks: string[];
  cta: string;
};

const PRICING_HREFS: Record<PricingTeaser['id'], string> = {
  free: '/register',
  pro: '/pricing?upgrade=pro',
  teams: '/book-demo',
};

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
 * resolve it into a workflow → see what it is → watch it work → see the evidence
 * → price → objections → act. Product discovery and comparison now live on the
 * dedicated product page, where visitors are asking for that depth.
 * Numbering survives in exactly one place, "How it works", because those three
 * steps genuinely are a sequence.
 *
 * Treatment varies with the job: evidence is a stat band, pricing is a plan
 * comparison, and objections are a disclosure list. Secondary material sits
 * below the primary call to action rather than between the reader and it.
 */
export default function LandingPage() {
  const t = useTranslations();
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

        {/* 7 · WHAT IT COSTS */}
        <HomeSection id="pricing">
          <HomeSectionHeader eyebrow={t('home.pricingHeading')} title={t('home.pricingTitle')} />
          <div className={styles.pricingPlans}>
            {(t.raw('home.pricingTeaser') as PricingTeaser[]).map((plan) => (
              <HomeCard
                key={plan.id}
                className={`${styles.pricingCard} ${plan.id === 'pro' ? styles.pricingCardFeatured : ''}`}
              >
                <CardTitle>{plan.name}</CardTitle>
                <div className={styles.price}>
                  {plan.id === 'free' && <><span>$0</span><small>{t('home.pricePerMonth')}</small></>}
                  {plan.id === 'pro' && (publicPlanPrices
                    ? <><span>${publicPlanPrices.pro}</span><small>{t('home.pricePerMonth')}</small></>
                    : <Link href="/pricing">{t('home.currentPricing')}</Link>)}
                  {plan.id === 'teams' && <span>{t('home.customPricing')}</span>}
                </div>
                <ul className={styles.perks}>{plan.perks.map((perk) => <li className={styles.perk} key={perk}>{perk}</li>)}</ul>
                <div className={styles.pricingCta}>
                  <HomeButton href={PRICING_HREFS[plan.id]} primary={plan.id === 'pro'}>{plan.cta}</HomeButton>
                </div>
              </HomeCard>
            ))}
          </div>
        </HomeSection>

        {/* 8 · OBJECTIONS — answered immediately before the ask, which is where
            they actually surface. */}
        <HomeSection>
          <HomeSectionHeader eyebrow={t('home.beat.questions')} title={t('home.faqHeading')} />
          <div className={styles.faq}>
            {(t.raw('home.homepageFaq') as FaqItem[]).map((faq, index) => (
              <details className={styles.faqItem} key={faq.question} open={index === 0}>
                <summary>{faq.question}</summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </HomeSection>

        {/* 9 · THE ASK */}
        <CreationCtaSection />

        {/* Secondary. Below the ask on purpose — these used to sit between the
            reader and the call to action. They stay on the page for the crawler
            and for the visitor who wants depth before deciding. */}
        <LatestBlogSection />
        <NewsletterSignupSection />
      </main>
    </>
  );
}

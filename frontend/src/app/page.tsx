'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import JsonLd from '@/components/JsonLd';
import { homepageSchema } from '@/lib/structured-data';
import { DemoShowcase } from '@/components/demo/DemoShowcase';
import { fetchPublicPricing, type PublicPricingPlan } from '@/lib/publicPricing';
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

type FaqItem = { question: string; answer: string };
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
 * resolve it into a workflow → see what it is → watch it work → price →
 * objections → act. Product discovery and comparison now live on the
 * dedicated product page, where visitors are asking for that depth.
 * Numbering survives in exactly one place, "How it works", because those three
 * steps genuinely are a sequence.
 *
 * Treatment varies with the job: pricing is a plan comparison, and objections
 * are a disclosure list. Secondary material sits
 * below the primary call to action rather than between the reader and it.
 */
export default function LandingPage() {
  const t = useTranslations();
  const locale = useLocale();
  const [publicPlans, setPublicPlans] = useState<PublicPricingPlan[]>([]);
  const [pricingCurrency, setPricingCurrency] = useState('USD');

  useEffect(() => {
    let active = true;
    fetchPublicPricing()
      .then((contract) => { if (active) { setPublicPlans(contract.plans); setPricingCurrency(contract.currency); } })
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

        {/* 4 · SEE IT RUN */}
        <DemoShowcase />

        {/* 5 · WHAT IT COSTS */}
        <HomeSection id="pricing">
          <HomeSectionHeader eyebrow={t('home.pricingHeading')} title={t('home.pricingTitle')} />
          <div className={styles.pricingPlans}>
            {publicPlans.map((plan) => (
              <HomeCard
                key={plan.id}
                className={`${styles.pricingCard} ${plan.id === 'pro' ? styles.pricingCardFeatured : ''}`}
              >
                <CardTitle>{plan.name}</CardTitle>
                <div className={styles.price}>
                  <span>{new Intl.NumberFormat(locale, { style: 'currency', currency: pricingCurrency, maximumFractionDigits: 0 }).format(plan.monthly)}</span><small>{plan.priceSuffix}</small>
                </div>
                <p>{plan.description}</p>
                <ul className={styles.perks}>{plan.features.map((perk) => <li className={styles.perk} key={perk}>{perk}</li>)}</ul>
                <div className={styles.pricingCta}>
                  <HomeButton href={plan.ctaHref} primary={plan.highlighted}>{plan.ctaLabel}</HomeButton>
                </div>
              </HomeCard>
            ))}
          </div>
        </HomeSection>

        {/* 6 · OBJECTIONS — answered immediately before the ask, which is where
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

        {/* 7 · THE ASK */}
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

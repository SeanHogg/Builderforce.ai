'use client';

/**
 * The homepage's "what it costs" band, self-contained: it fetches the public
 * pricing contract itself, formats money in the reader's locale itself, and
 * renders nothing until it has real plans. It never invents a fallback price —
 * a wrong number on a pricing page is worse than no pricing band at all.
 *
 * It owns the fetch so the PAGE does not have to. Reading pricing in the page's
 * `useEffect` is what made the whole homepage — every marketing section, the
 * structured data, the FAQ copy — a client component.
 */
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { fetchPublicPricing, type PublicPricingPlan } from '@/lib/publicPricing';
import {
  CardTitle,
  HomeButton,
  HomeCard,
  HomeSection,
  HomeSectionHeader,
  homePatternStyles as styles,
} from '@/components/home/HomePatterns';

export function HomePricingSection() {
  const t = useTranslations();
  const locale = useLocale();
  const [plans, setPlans] = useState<PublicPricingPlan[]>([]);
  const [currency, setCurrency] = useState('USD');

  useEffect(() => {
    let active = true;
    fetchPublicPricing()
      .then((contract) => { if (active) { setPlans(contract.plans); setCurrency(contract.currency); } })
      .catch(() => { /* Pricing CTA remains available; never invent a fallback price. */ });
    return () => { active = false; };
  }, []);

  return (
    <HomeSection id="pricing">
      <HomeSectionHeader eyebrow={t('home.pricingHeading')} title={t('home.pricingTitle')} />
      <div className={styles.pricingPlans}>
        {plans.map((plan) => (
          <HomeCard
            key={plan.id}
            className={`${styles.pricingCard} ${plan.id === 'pro' ? styles.pricingCardFeatured : ''}`}
          >
            <CardTitle>{plan.name}</CardTitle>
            <div className={styles.price}>
              <span>{new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(plan.monthly)}</span><small>{plan.priceSuffix}</small>
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
  );
}

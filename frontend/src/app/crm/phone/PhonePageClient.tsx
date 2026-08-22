'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';
import { useCart } from '@/lib/CartContext';
import { usePhone } from '@/lib/usePhone';
import { fetchPublicPricing, type PublicPricingContract } from '@/lib/publicPricing';
import styles from './phone.module.css';

/**
 * `/crm/phone` — the page that SELLS Business Phone.
 *
 * ── WHY THE CONSOLE IS NOT HERE ──────────────────────────────────────────────
 * This route is in `PUBLIC_SHELL_PREFIXES`, which means it renders inside the
 * marketing shell whether or not you are signed in. That is right for a shop and
 * wrong for a console: an operator managing numbers and credit inside marketing
 * chrome has no app navigation and no way back to their workspace. So the console
 * lives at `/inbox?tab=phone`, an app route with the shell and the nav tab, and
 * this page sends an active subscriber there.
 *
 * The redirect also catches the checkout's own `successUrl`
 * (`/crm/phone?purchase=success`), which is how somebody who has just bought the
 * add-on arrives — and, until now, arrived at the sentence "Active ·
 * provisioning" with nothing behind it.
 */
export default function PhonePageClient() {
  const router = useRouter();
  const { overview } = usePhone();
  const active = overview?.plan.active ?? false;

  useEffect(() => {
    if (active) router.replace('/inbox?tab=phone');
  }, [active, router]);

  // Rendering the shop for the frame before the redirect lands would flash "buy
  // this" at somebody who already owns it.
  if (active) return null;
  return <PhoneOffer />;
}

/** The shop: what somebody who has not bought the add-on should see. */
function PhoneOffer() {
  const t = useTranslations('pricing.phone');
  const pageT = useTranslations('phonePage');
  const { isAuthenticated } = useAuth();
  const { addItem, hasItem, openCart } = useCart();
  const [pricing, setPricing] = useState<PublicPricingContract | null>(null);

  useEffect(() => { void fetchPublicPricing().then(setPricing); }, []);

  const phone = pricing?.businessPhone;
  const add = () => {
    if (!phone) return;
    const id = 'service:business-phone';
    if (hasItem(id)) return openCart();
    addItem({ id, type: 'service', slug: 'business-phone', name: t('title'), price: phone.monthly, setupFee: phone.activation, pricingModel: 'subscription', priceUnit: t('perMonth'), checkoutKind: 'business_phone', emoji: 'phone' });
  };

  return <main className={styles.page}>
    <section className={styles.hero}>
      <div><p className={styles.eyebrow}>{t('eyebrow')}</p><h1>{t('title')}</h1><p>{t('description')}</p></div>
      <div className={styles.offer}>
        <strong>{phone ? `$${phone.monthly.toFixed(2)}${t('perMonth')}` : '—'}</strong>
        <p>{phone ? t('activation', { price: phone.activation }) : pageT('loading')}</p>
        <button type="button" onClick={add} disabled={!phone}>{hasItem('service:business-phone') ? t('viewCart') : t('addToCart')}</button>
        {!isAuthenticated && <Link href="/register">{pageT('createAccount')}</Link>}
      </div>
    </section>
    <section className={styles.details}>
      <article><h2>{t('dedicatedNumber')}</h2><p>{t('forwarding')}</p></article>
      <article><h2>{pageT('voiceMessaging')}</h2><p>{phone ? t('allowance', { minutes: phone.includedMinutes, sms: phone.includedSms, mms: phone.includedMms }) : pageT('loading')}</p></article>
      <article><h2>{pageT('transparentUsage')}</h2><p>{phone ? t('overages', { minute: phone.overagePerMinute, sms: phone.overagePerSms, mms: phone.overagePerMms }) : pageT('loading')}</p></article>
    </section>
  </main>;
}

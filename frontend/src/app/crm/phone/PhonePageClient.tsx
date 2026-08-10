'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';
import { useCart } from '@/lib/CartContext';
import { AUTH_API_URL, getStoredTenantToken } from '@/lib/auth';
import { fetchPublicPricing, type PublicPricingContract } from '@/lib/publicPricing';
import styles from './phone.module.css';

export default function PhonePageClient() {
  const t = useTranslations('pricing.phone');
  const pageT = useTranslations('phonePage');
  const { isAuthenticated, tenant } = useAuth();
  const { addItem, hasItem, openCart } = useCart();
  const [pricing, setPricing] = useState<PublicPricingContract | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => { void fetchPublicPricing().then(setPricing); }, []);
  useEffect(() => {
    if (!tenant?.id) return;
    const token = getStoredTenantToken();
    void fetch(`${AUTH_API_URL}/api/tenants/${tenant.id}/add-ons/business-phone`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((response) => response.ok ? response.json() : null)
      .then((body: { subscription?: { status?: string } } | null) => setStatus(body?.subscription?.status ?? null));
  }, [tenant?.id]);

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
        {status === 'active' ? <><strong>{pageT('active')}</strong><p>{pageT('provisioning')}</p></> : <>
          <strong>{phone ? `$${phone.monthly.toFixed(2)}${t('perMonth')}` : '—'}</strong>
          <p>{phone ? t('activation', { price: phone.activation }) : pageT('loading')}</p>
          <button type="button" onClick={add} disabled={!phone}>{hasItem('service:business-phone') ? t('viewCart') : t('addToCart')}</button>
          {!isAuthenticated && <Link href="/register">{pageT('createAccount')}</Link>}
        </>}
      </div>
    </section>
    <section className={styles.details}>
      <article><h2>{t('dedicatedNumber')}</h2><p>{t('forwarding')}</p></article>
      <article><h2>{pageT('voiceMessaging')}</h2><p>{phone ? t('allowance', { minutes: phone.includedMinutes, sms: phone.includedSms, mms: phone.includedMms }) : pageT('loading')}</p></article>
      <article><h2>{pageT('transparentUsage')}</h2><p>{phone ? t('overages', { minute: phone.overagePerMinute, sms: phone.overagePerSms, mms: phone.overagePerMms }) : pageT('loading')}</p></article>
    </section>
  </main>;
}

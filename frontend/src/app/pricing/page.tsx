import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { pageMetadata } from '@/lib/seo';
import PricingPageClient from './PricingPageClient';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('pricing.seo');
  const base = pageMetadata({
    title: t('title'),
    description: t('description'),
    path: '/pricing',
    ogTitle: t('ogTitle'),
  });
  return {
    ...base,
    openGraph: { ...base.openGraph, description: t('ogDescription') },
    twitter: { ...base.twitter, title: t('twitterTitle'), description: t('twitterDescription') },
  };
}

export default function PricingPage() {
  return <PricingPageClient />;
}

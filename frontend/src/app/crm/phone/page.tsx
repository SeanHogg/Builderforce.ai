import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { pageMetadata } from '@/lib/seo';
import PhonePageClient from './PhonePageClient';

export const runtime = 'edge';
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('phonePage');
  return pageMetadata({ title: t('seoTitle'), description: t('seoDescription'), path: '/crm/phone' });
}

export default function PhonePage() { return <PhonePageClient />; }

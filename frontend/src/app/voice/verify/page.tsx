import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { pageMetadata } from '@/lib/seo';
import VoiceVerifyClient from './VoiceVerifyClient';

export const runtime = 'edge';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('voice.provenance.verifyPage');
  return pageMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/voice/verify',
  });
}

export default function VoiceVerifyPage() {
  return (
    <Suspense fallback={null}>
      <VoiceVerifyClient />
    </Suspense>
  );
}

import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { pageMetadata } from '@/lib/seo';
import PersonProfileClient from '@/components/people/PersonProfileClient';

export const runtime = 'edge';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations('personProfile');
  // The canonical is the profile's own URL: there is no `/people` index page.
  return pageMetadata({ title: t('seoTitle'), description: t('seoDescription'), path: `/people/${encodeURIComponent(id)}` });
}

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <PersonProfileClient userId={id} />
    </Suspense>
  );
}

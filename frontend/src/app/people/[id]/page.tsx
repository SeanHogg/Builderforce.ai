import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { pageMetadata } from '@/lib/seo';
import PersonProfileClient from '@/components/people/PersonProfileClient';

export const runtime = 'edge';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('personProfile');
  return pageMetadata({ title: t('seoTitle'), description: t('seoDescription'), path: '/people' });
}

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <PersonProfileClient userId={id} />
    </Suspense>
  );
}

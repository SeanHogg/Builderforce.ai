import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { pageMetadata } from '@/lib/seo';
import BlogPageClient from './BlogPageClient';

// next-on-pages requires every non-static route to opt into the Edge Runtime.
export const runtime = 'edge';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('blog.seo');
  const base = pageMetadata({
    title: t('title'),
    description: t('description'),
    path: '/blog',
    ogTitle: t('ogTitle'),
  });
  return {
    ...base,
    openGraph: { ...base.openGraph, description: t('ogDescription') },
    twitter: { ...base.twitter, title: t('ogTitle'), description: t('twitterDescription') },
  };
}

export default function BlogPage() {
  // BlogPageClient reads `?page=` via useSearchParams, which Next requires to sit
  // under a Suspense boundary.
  return (
    <Suspense>
      <BlogPageClient />
    </Suspense>
  );
}

import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { pageMetadata } from '@/lib/seo';
import BlogPageClient from './BlogPageClient';

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
  return <BlogPageClient />;
}

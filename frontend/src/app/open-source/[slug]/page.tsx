import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import PackageDetail from '@/components/openSource/PackageDetail';
import { openSourceBySlug, openSourcePath } from '@/lib/openSourcePackages';
import { pageMetadata } from '@/lib/seo';

// Dynamic on the Edge Runtime, NOT statically prerendered — the same shape as
// /compare/[competitor] and /integrations/[tool]. `getTranslations()` reads the
// locale cookie, which makes the route dynamic, and Next 15.5 forbids combining
// `generateStaticParams` with `runtime = 'edge'`. An unknown slug 404s through
// `notFound()`; the sitemap enumerates the valid ones from the registry.
export const runtime = 'edge';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const entry = openSourceBySlug(slug);
  const t = await getTranslations('openSource');
  if (!entry) return { title: t('detail.notFound') };
  return pageMetadata({
    title: t('detail.seoTitle', { name: entry.displayName }),
    description: t(`packages.${entry.key}.summary`),
    path: openSourcePath(entry),
    ogTitle: entry.displayName,
  });
}

export default async function OpenSourcePackagePage({ params }: Params) {
  const { slug } = await params;
  const entry = openSourceBySlug(slug);
  if (!entry) notFound();
  return <PackageDetail entry={entry} />;
}

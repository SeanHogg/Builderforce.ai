import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PublishedWebsitePage } from '@/components/site/PublishedWebsitePage';
import { fetchPublicWebsitePage } from '@/lib/publicApi';
import { websiteCanonicalUrl, websitePagePath } from '@/lib/websitePagePath';

/**
 * `/w/<owner>/<path…>` — a published website page, rendered on the server for SEO.
 *
 * `owner` is a workspace id or `platform`; the rest is the page's own path, so
 * `/w/42/docs/pricing` reads the page published at `/docs/pricing` and `/w/42` reads
 * `/`. Unauthenticated by construction: the page is public and the API serves it
 * from its version-token cache. A missing page is a real 404: `middleware.ts`
 * resolves existence BEFORE render (`websitePageGate`) and rewrites to the hard-404
 * route, because a `notFound()` thrown here can stream a 200 on the edge. The
 * `notFound()` below is only the fallback for a page that vanishes in between.
 *
 * `runtime = 'edge'` because this route is not static; without it `next-on-pages`
 * refuses the build.
 */
export const runtime = 'edge';

type Params = { owner: string; path?: string[] };

/** One API read per render: `generateMetadata` and the page share it. */
const loadPage = cache(fetchPublicWebsitePage);

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { owner, path } = await params;
  const pagePath = websitePagePath(path);
  if (pagePath === null) return {};
  const page = await loadPage(owner, pagePath);
  if (!page) return {};
  const canonical = websiteCanonicalUrl(owner, pagePath, page.canonicalPath);
  return {
    title: page.title,
    alternates: { canonical },
    openGraph: { title: page.title, type: 'website', url: canonical },
    twitter: { title: page.title },
  };
}

export default async function PublicWebsiteRoute({ params }: { params: Promise<Params> }) {
  const { owner, path } = await params;
  const pagePath = websitePagePath(path);
  if (pagePath === null) notFound();
  const page = await loadPage(owner, pagePath);
  if (!page) notFound();
  return <PublishedWebsitePage page={page} />;
}

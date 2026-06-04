import type { Metadata } from 'next';
import { BRAND } from './content';

/**
 * One builder for per-page metadata so title/description/canonical/OG/Twitter
 * stay consistent across every route instead of each page hand-rolling (and
 * drifting on) its own `<head>`. Pass page-specific copy; canonical + og:url are
 * derived from the path. For richer entity pages, spread the result and add
 * extra fields (article `publishedTime`, `authors`, etc.).
 */
export interface PageSeo {
  title: string;
  description: string;
  /** Absolute-from-root path, e.g. "/product" or "/blog/my-post". */
  path: string;
  type?: 'website' | 'article';
  /** Override the OG/Twitter title when the social headline should differ. */
  ogTitle?: string;
}

export function pageMetadata({ title, description, path, type = 'website', ogTitle }: PageSeo): Metadata {
  const url = `${BRAND.url}${path}`;
  const socialTitle = ogTitle ?? title;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title: socialTitle, description, url, type },
    twitter: { title: socialTitle, description },
  };
}

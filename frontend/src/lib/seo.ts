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

/**
 * One shared social-card image for every link preview. We deliberately serve the
 * STATIC branded PNG (`/og-image.png`) rather than a `next/og` ImageResponse route:
 * on the Cloudflare edge runtime the Satori/resvg WASM path returns an empty 0-byte
 * PNG, which makes iMessage/SMS/Slack fall back to a stale cached preview (the old
 * mascot). A real static asset always unfurls on-brand. `metadataBase` (set in the
 * root layout) resolves the relative path to an absolute URL.
 */
export const OG_IMAGE = {
  url: BRAND.ogImage,
  width: BRAND.ogImageWidth,
  height: BRAND.ogImageHeight,
  alt: BRAND.name,
} as const;

export function pageMetadata({ title, description, path, type = 'website', ogTitle }: PageSeo): Metadata {
  const url = `${BRAND.url}${path}`;
  const socialTitle = ogTitle ?? title;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title: socialTitle, description, url, type, images: [OG_IMAGE] },
    twitter: { title: socialTitle, description, images: [BRAND.ogImage] },
  };
}

import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { getPostBySlug } from '@/lib/blogData';
import { blogTagLabel, loadPostBody, localizePost, type BlogText } from '@/lib/blogLocale';
import { BRAND } from '@/lib/content/brand';
import { pageMetadata } from '@/lib/seo';
import { DEFAULT_LOCALE } from '@/i18n/config';
import { requestOrigin } from '@/i18n/requestOrigin';
import BlogPostClient from './BlogPostClient';

export const runtime = 'edge';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  const t = (await getTranslations('blog')) as unknown as BlogText;
  if (!post) {
    return { title: t('post.notFoundTitle') };
  }
  // The head a link preview and a crawler receive is in the reader's language —
  // the same title and description the page renders (`localizePost`).
  const localized = localizePost(post, t);
  const base = pageMetadata({
    title: localized.title,
    description: localized.description,
    path: `/blog/${slug}`,
    type: 'article',
  });
  // Per-article card, rendered at build time by `scripts/gen-blog-og.mjs`.
  // Without it all 125 posts shared the site-wide `/og-image.png`, so a link to
  // one article previewed identically to a link to the home page — the one
  // thing a share is supposed to distinguish.
  const ogImage = { url: `/blog/og/${slug}.png`, width: 1200, height: 630, alt: localized.title };
  return {
    ...base,
    openGraph: {
      ...base.openGraph,
      type: 'article',
      publishedTime: post.date,
      modifiedTime: post.date,
      authors: [post.author || BRAND.founder.name],
      tags: post.tags.map((tag) => blogTagLabel(tag, t)),
      images: [ogImage],
    },
    twitter: { ...base.twitter, images: [ogImage.url] },
  };
}

/**
 * Resolves the article BODY on the server, in the reader's language, so the
 * HTML a crawler or a first paint receives is already translated (see
 * `lib/blogLocale.ts` for why bodies are fetched rather than bundled). The
 * default locale's body is in the bundle already, so nothing is passed for it.
 */
export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  const locale = await getLocale();
  const content = post && locale !== DEFAULT_LOCALE ? await loadPostBody(post, locale, await requestOrigin()) : undefined;
  return <BlogPostClient slug={slug} content={content} />;
}

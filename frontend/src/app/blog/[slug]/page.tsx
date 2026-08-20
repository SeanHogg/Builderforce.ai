import type { Metadata } from 'next';
import { getPostBySlug } from '@/lib/blogData';
import { BRAND } from '@/lib/content';
import { pageMetadata } from '@/lib/seo';
import BlogPostClient from './BlogPostClient';

export const runtime = 'edge';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) {
    return { title: 'Post Not Found' };
  }
  const base = pageMetadata({
    title: post.title,
    description: post.description,
    path: `/blog/${slug}`,
    type: 'article',
  });
  // Per-article card, rendered at build time by `scripts/gen-blog-og.mjs`.
  // Without it all 125 posts shared the site-wide `/og-image.png`, so a link to
  // one article previewed identically to a link to the home page — the one
  // thing a share is supposed to distinguish.
  const ogImage = { url: `/blog/og/${slug}.png`, width: 1200, height: 630, alt: post.title };
  return {
    ...base,
    openGraph: {
      ...base.openGraph,
      type: 'article',
      publishedTime: post.date,
      modifiedTime: post.date,
      authors: [post.author || BRAND.founder.name],
      tags: post.tags,
      images: [ogImage],
    },
    twitter: { ...base.twitter, images: [ogImage.url] },
  };
}

export default function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  return <BlogPostClient params={params} />;
}

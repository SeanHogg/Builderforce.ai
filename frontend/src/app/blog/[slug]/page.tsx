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
  return {
    ...base,
    openGraph: {
      ...base.openGraph,
      type: 'article',
      publishedTime: post.date,
      modifiedTime: post.date,
      authors: [post.author || BRAND.founder.name],
      tags: post.tags,
    },
  };
}

export default function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  return <BlogPostClient params={params} />;
}

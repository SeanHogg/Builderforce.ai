import type { Metadata } from 'next';
import { getPostBySlug, BLOG_POSTS } from '@/lib/blogData';
import { BRAND } from '@/lib/content';
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
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/blog/${slug}` },
    openGraph: {
      title: post.title,
      description: post.description,
      url: `${BRAND.url}/blog/${slug}`,
      type: 'article',
      publishedTime: post.date,
      modifiedTime: post.date,
      authors: [post.author || BRAND.founder.name],
      tags: post.tags,
    },
    twitter: {
      title: post.title,
      description: post.description,
    },
  };
}

export async function generateStaticParams() {
  return BLOG_POSTS.map((post) => ({ slug: post.slug }));
}

export default function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  return <BlogPostClient params={params} />;
}

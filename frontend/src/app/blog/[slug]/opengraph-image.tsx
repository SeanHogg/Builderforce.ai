import { getPostBySlug } from '@/lib/blogData';
import { renderBrandOg, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og';

export const runtime = 'edge';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Builderforce.ai blog post';

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  return renderBrandOg({ eyebrow: 'Blog', title: post?.title ?? 'Builderforce.ai Blog' });
}

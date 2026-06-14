import { renderBrandOg, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og';
import { COMPETITOR_SEO, COMPETITOR_SLUG_TO_KEY } from '@/lib/content';

export const runtime = 'edge';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Builderforce.ai comparison';

export default async function Image({ params }: { params: Promise<{ competitor: string }> }) {
  const { competitor } = await params;
  const key = COMPETITOR_SLUG_TO_KEY[competitor];
  const name = key ? COMPETITOR_SEO[key]?.name : undefined;
  return renderBrandOg({ eyebrow: 'Compare', title: `Builderforce.ai vs ${name ?? 'the field'}` });
}

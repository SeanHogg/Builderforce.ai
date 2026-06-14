import { renderBrandOg, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og';
import { INTEGRATION_SLUG_MAP } from '@/lib/content';

export const runtime = 'edge';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Builderforce.ai integration';

export default async function Image({ params }: { params: Promise<{ tool: string }> }) {
  const { tool } = await params;
  const seo = INTEGRATION_SLUG_MAP[tool];
  return renderBrandOg({ eyebrow: 'Integration', title: `Builderforce.ai + ${seo?.name ?? 'your stack'}` });
}

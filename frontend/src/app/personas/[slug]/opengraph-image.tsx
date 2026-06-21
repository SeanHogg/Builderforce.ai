import { renderBrandOg, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og';
import { getPublishedPersonaName } from '@/lib/marketplaceSeo';
import { BUILTIN_PERSONAS } from '@/lib/marketplaceData';

export const runtime = 'edge';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Builderforce.ai agent persona';

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const builtin = BUILTIN_PERSONAS.find((p) => p.name === slug);
  const name = builtin?.name ?? (await getPublishedPersonaName(slug));
  return renderBrandOg({ eyebrow: 'Persona', title: name || 'Agent persona' });
}

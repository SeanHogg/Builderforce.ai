import { renderBrandOg, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og';
import { getPublishedSkill } from '@/lib/marketplaceSeo';
import { BUILTIN_SKILLS } from '@/lib/marketplaceData';

export const runtime = 'edge';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Builderforce.ai agent skill';

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const builtin = BUILTIN_SKILLS.find((s) => s.slug === slug);
  const name = builtin?.name ?? (await getPublishedSkill(slug))?.name;
  return renderBrandOg({ eyebrow: 'Skill', title: name || 'Agent skill' });
}

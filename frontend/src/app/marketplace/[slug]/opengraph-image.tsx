import { renderBrandOg, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og';
import { getPublishedSkill } from '@/lib/marketplaceSeo';

export const runtime = 'edge';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Builderforce.ai Workforce Registry skill';

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const skill = await getPublishedSkill(slug);
  return renderBrandOg({ eyebrow: 'Workforce Registry', title: skill?.name ?? 'Workforce Registry' });
}

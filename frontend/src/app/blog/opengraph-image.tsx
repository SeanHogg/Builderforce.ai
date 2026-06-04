import { renderBrandOg, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og';

export const runtime = 'edge';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Builderforce.ai Blog';

export default function Image() {
  return renderBrandOg({ eyebrow: 'Blog', title: 'Deep dives on building & training AI agents' });
}

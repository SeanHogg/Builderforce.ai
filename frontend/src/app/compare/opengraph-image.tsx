import { renderBrandOg, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og';

export const runtime = 'edge';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'How Builderforce.ai compares';

export default function Image() {
  return renderBrandOg({ eyebrow: 'Compare', title: 'See how Builderforce.ai stacks up' });
}

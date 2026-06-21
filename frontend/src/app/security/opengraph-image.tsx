import { renderBrandOg, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og';

export const runtime = 'edge';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Builderforce.ai security — review & approve every agent action';

export default function Image() {
  return renderBrandOg({ eyebrow: 'Security', title: 'Review & approve every agent action' });
}

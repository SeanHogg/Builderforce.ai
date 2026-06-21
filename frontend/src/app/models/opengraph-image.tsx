import { renderBrandOg, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og';

export const runtime = 'edge';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Builderforce.ai models — Free, Pro & the full live catalog';

export default function Image() {
  return renderBrandOg({ eyebrow: 'Models', title: 'Free, Pro & the full live model catalog' });
}

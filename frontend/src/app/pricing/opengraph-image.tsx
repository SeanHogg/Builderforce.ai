import { renderBrandOg, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og';

export const runtime = 'edge';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Builderforce.ai pricing — Free, Pro & Teams plans';

export default function Image() {
  return renderBrandOg({ eyebrow: 'Pricing', title: 'Free forever. Pro & Teams that scale with your workforce' });
}

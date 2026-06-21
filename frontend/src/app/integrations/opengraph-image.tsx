import { renderBrandOg, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og';

export const runtime = 'edge';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Connect your AI workforce to your stack';

export default function Image() {
  return renderBrandOg({ eyebrow: 'Integrations', title: 'Connect your AI workforce to your whole stack' });
}

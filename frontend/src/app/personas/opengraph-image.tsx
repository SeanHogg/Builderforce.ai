import { renderBrandOg, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og';

export const runtime = 'edge';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Builderforce.ai personas — give your agents a personality & decision style';

export default function Image() {
  return renderBrandOg({ eyebrow: 'Personas', title: 'Give your agents a personality & decision style' });
}

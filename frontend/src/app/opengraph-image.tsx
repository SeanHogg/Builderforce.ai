import { renderBrandOg, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og';

export const runtime = 'edge';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Builderforce.ai — build, train & command your own AI workforce';

export default function Image() {
  return renderBrandOg({ title: 'Build, train & command your own AI workforce' });
}

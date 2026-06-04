import { renderBrandOg, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og';

export const runtime = 'edge';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'The Builderforce.ai platform';

export default function Image() {
  return renderBrandOg({ eyebrow: 'The Platform', title: 'Build, train, orchestrate & govern your AI workforce' });
}

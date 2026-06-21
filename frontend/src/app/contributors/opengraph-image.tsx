import { renderBrandOg, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og';

export const runtime = 'edge';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'The people & agents building Builderforce.ai';

export default function Image() {
  return renderBrandOg({ eyebrow: 'Contributors', title: 'The people & agents building Builderforce.ai' });
}

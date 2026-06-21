import { renderBrandOg, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og';

export const runtime = 'edge';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'A shared library of battle-tested prompts';

export default function Image() {
  return renderBrandOg({ eyebrow: 'Prompts', title: 'A shared library of battle-tested prompts' });
}

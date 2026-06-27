import { renderBrandOg, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og';

export const runtime = 'edge';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Evermind — the Builderforce.ai LLM';

export default function Image() {
  return renderBrandOg({ eyebrow: 'Meet Evermind', title: 'The self-updating Builderforce.ai LLM' });
}

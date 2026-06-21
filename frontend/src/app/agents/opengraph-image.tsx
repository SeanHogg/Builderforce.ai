import { renderBrandOg, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og';

export const runtime = 'edge';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'BuilderForce Agents — self-hosted multi-agent coding workflows';

export default function Image() {
  return renderBrandOg({ eyebrow: 'Open Source', title: 'Self-hosted multi-agent coding workflows' });
}

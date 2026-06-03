import { renderBrandOg, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og';

export const runtime = 'edge';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Builderforce.ai Workforce Marketplace';

export default function Image() {
  return renderBrandOg({ eyebrow: 'Workforce', title: 'Hire, install & publish AI agents, skills & personas' });
}

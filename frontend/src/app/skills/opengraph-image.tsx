import { renderBrandOg, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og';

export const runtime = 'edge';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Builderforce.ai skills — install, build & publish agent skills';

export default function Image() {
  return renderBrandOg({ eyebrow: 'Skills', title: 'Install, build & publish agent skills' });
}

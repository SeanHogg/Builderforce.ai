import { CofounderMatching } from '@/components/cofounder/CofounderMatching';

/**
 * `/cofounder` — the first question a company asks, which the platform had no
 * answer to at all.
 *
 * `runtime = 'edge'` because this route is not static; without it `next-on-pages`
 * refuses the build.
 */
export const runtime = 'edge';

export default function CofounderPage() {
  return <CofounderMatching />;
}

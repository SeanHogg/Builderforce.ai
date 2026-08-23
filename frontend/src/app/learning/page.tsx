import { pageMetadata } from '@/lib/seo';
import { LearningView } from '@/components/learning/LearningView';
import PageContainer from '@/components/PageContainer';

export const runtime = 'edge';

export const metadata = pageMetadata({
  title: 'Learning',
  description:
    'Learning paths over your courses, prerequisites that gate them, and the workspace’s own xAPI Learning Record Store — the endpoint an authoring tool sends statements to.',
  path: '/learning',
});

/**
 * `/learning` — curricula, the gated catalogue, and the LRS.
 *
 * A Server Component wrapper over one client surface, matching `/companies` and
 * every other destination: the route boundary stays on the server and exactly one
 * file crosses into the client bundle.
 */
export default function LearningPage() {
  return <PageContainer><LearningView /></PageContainer>;
}

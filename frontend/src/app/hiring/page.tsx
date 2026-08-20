import { pageMetadata } from '@/lib/seo';
import HiringClient from '@/components/hiring/HiringClient';

export const runtime = 'edge';

export const metadata = pageMetadata({
  title: 'Hiring',
  description:
    'The applicant pipeline: candidates by stage, the résumé they applied with, the interview kit that scores them, the decision that moves them and the offer that closes it — with every stage change feeding the hiring funnel.',
  path: '/hiring',
});

/**
 * The Recruiter's working surface.
 *
 * A Server Component wrapper over one client entry, matching `/quality` and every other
 * destination: the route boundary stays on the server, and exactly one file crosses into
 * the client bundle.
 */
export default function HiringPage() {
  return <HiringClient />;
}

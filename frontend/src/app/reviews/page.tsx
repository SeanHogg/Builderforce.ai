import { pageMetadata } from '@/lib/seo';
import { EmployersView } from '@/components/employers/EmployersView';
import PageContainer from '@/components/PageContainer';

export const runtime = 'edge';

export const metadata = pageMetadata({
  title: 'Employer reviews',
  description:
    'Read and write reviews of employers: a headline rating plus culture, leadership, work-life balance, compensation, career growth and diversity, moderated before publication.',
  path: '/reviews',
});

/**
 * `/reviews` — the same surface as `/companies`, entered from the other side.
 *
 * Both URLs are linked by ported articles and both were 404ing. They render ONE
 * view deliberately: a separate "reviews" implementation would be a second place
 * the pending-until-approved rule has to be remembered, and it only has to be
 * forgotten once to publish an unapproved claim about a named company.
 */
export default function ReviewsPage() {
  return <PageContainer><EmployersView /></PageContainer>;
}

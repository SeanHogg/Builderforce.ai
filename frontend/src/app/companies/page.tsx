import { pageMetadata } from '@/lib/seo';
import { EmployersView } from '@/components/employers/EmployersView';
import PageContainer from '@/components/PageContainer';

export const runtime = 'edge';

export const metadata = pageMetadata({
  title: 'Companies',
  description:
    'The employer directory: what a company is rated on culture, leadership, work-life balance, compensation, career growth and diversity, by the people who worked there.',
  path: '/companies',
});

/**
 * `/companies` — the employer directory.
 *
 * A Server Component wrapper over one client surface, matching `/hiring` and every
 * other destination: the route boundary stays on the server and exactly one file
 * crosses into the client bundle.
 *
 * `/reviews` renders the SAME view rather than a second one. Three ported articles
 * link to each of them, and they describe one thing from two directions — browsing
 * employers, and reading what was said about them. Two implementations would be two
 * places for the moderation rule to be got wrong.
 */
export default function CompaniesPage() {
  return <PageContainer><EmployersView /></PageContainer>;
}

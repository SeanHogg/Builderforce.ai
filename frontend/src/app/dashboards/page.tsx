import { pageMetadata } from '@/lib/seo';
import DashboardsClient from './DashboardsClient';

export const runtime = 'edge';

export const metadata = pageMetadata({
  title: 'Custom Dashboards',
  description:
    'Build saved dashboards from widgets over your existing delivery, FinOps and AI-effectiveness metrics — and ask plain-English questions that map to a safe metric query.',
  path: '/dashboards',
});

export default function DashboardsPage() {
  return <DashboardsClient />;
}

import { pageMetadata } from '@/lib/seo';
import FinopsClient from './FinopsClient';

export const runtime = 'edge';

export const metadata = pageMetadata({
  title: 'DevFinOps',
  description:
    'R&D tax credit (QRE) estimates, SOC 1 Type II control coverage, and one-click audit-ready period reports — derived from effort, cost and the immutable agent-tool audit trail.',
  path: '/finops',
});

export default function FinopsPage() {
  return <FinopsClient />;
}

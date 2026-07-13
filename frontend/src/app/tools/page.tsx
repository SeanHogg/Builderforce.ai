import type { Metadata } from 'next';
import JsonLd from '@/components/JsonLd';
import RelatedArticles from '@/components/blog/RelatedArticles';
import { pageMetadata } from '@/lib/seo';
import { routeMarketingSchema } from '@/lib/structured-data';
import ToolsHubClient from './ToolsHubClient';

export const runtime = 'edge';

export const metadata: Metadata = pageMetadata({
  title: 'Free Diagnostics & Tools for Engineering Leaders',
  description:
    'A free suite of diagnostics and calculators for CTOs, directors, and team leads: a DORA quick-check, an AI cost / FinOps estimator, a COBIT governance readiness assessment, a delivery-risk audit, and the full agentic maturity diagnostic. Run any of them instantly — no login required; sign in to save results and track them over time.',
  path: '/tools',
  ogTitle: 'BuilderForce Diagnostics & Tools — Assess, Cost, and Plan to Innovate',
});

export default function ToolsPage() {
  return (
    <>
      <JsonLd
        data={routeMarketingSchema({
          path: '/tools',
          title: 'Diagnostics & Tools',
          description: metadata.description as string,
        })}
      />
      <ToolsHubClient />
      <RelatedArticles surface="diagnostics" heading="Plan how to innovate" />
    </>
  );
}

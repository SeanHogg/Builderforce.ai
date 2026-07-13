import type { Metadata } from 'next';
import JsonLd from '@/components/JsonLd';
import RelatedArticles from '@/components/blog/RelatedArticles';
import { pageMetadata } from '@/lib/seo';
import { routeMarketingSchema } from '@/lib/structured-data';
import PromptsPageClient from './PromptsPageClient';

export const runtime = 'edge';

export const metadata: Metadata = pageMetadata({
  title: 'Prompt Library — Reusable AI Prompt Templates',
  description:
    'Browse, use, and share community prompt templates with variables on Builderforce.ai. A growing library of reusable AI prompts your agents and team can run, plus built-in templates for planning, coding, and review.',
  path: '/prompts',
  ogTitle: 'Builderforce.ai Prompt Library — Reusable AI Prompt Templates',
});

export default function PromptsPage() {
  return (
    <>
      <JsonLd
        data={routeMarketingSchema({
          path: '/prompts',
          title: 'Prompt Library',
          description: metadata.description as string,
        })}
      />
      <PromptsPageClient />
      <RelatedArticles surface="prompts" heading="Related reading" />
    </>
  );
}

import type { Metadata } from 'next';
import JsonLd from '@/components/JsonLd';
import { pageMetadata } from '@/lib/seo';
import { routeMarketingSchema } from '@/lib/structured-data';
import ToolRunnerClient from './ToolRunnerClient';

export const runtime = 'edge';

const ACRONYMS: Record<string, string> = { dora: 'DORA', ai: 'AI', cobit: 'COBIT' };
function humanize(id: string): string {
  return id.split('-').map((w) => ACRONYMS[w] ?? (w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const name = humanize(id);
  return pageMetadata({
    title: `${name} — Free Diagnostic Tool`,
    description: `Run the ${name} diagnostic free in your browser — no login required. Get an instant rating and a prioritized plan to improve. Sign in to save your result and track it over time.`,
    path: `/tools/${id}`,
    ogTitle: `${name} — BuilderForce Diagnostics`,
  });
}

export default async function ToolRunnerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <JsonLd
        data={routeMarketingSchema({
          path: `/tools/${id}`,
          title: humanize(id),
          description: `Free ${humanize(id)} diagnostic — instant rating and an improvement plan.`,
        })}
      />
      <ToolRunnerClient toolId={id} />
    </>
  );
}

import { Suspense } from 'react';
import type { Metadata } from 'next';
import JsonLd from '@/components/JsonLd';
import { pageMetadata } from '@/lib/seo';
import { routeMarketingSchema } from '@/lib/structured-data';
import ToolReferenceClient from './ToolReferenceClient';

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

/**
 * A tool is a REFERENCE page (PRD 21 §11.4.5): signed out it is this page at
 * this URL with this SEO; signed in the same component mounts in `ShellPanel`
 * over a board that stays running. `humanize(id)` is the title the crawler and
 * the first paint get — the catalog's real name replaces it as soon as the
 * definition loads, and the panel header follows it.
 */
export default async function ToolReferencePage({ params }: { params: Promise<{ id: string }> }) {
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
      {/* The runner reads `?project=` to attribute a saved run, so the tree below
          is search-param dependent and needs its own boundary. */}
      <Suspense fallback={null}>
        <ToolReferenceClient toolId={id} fallbackName={humanize(id)} />
      </Suspense>
    </>
  );
}

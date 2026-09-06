import type { Metadata } from 'next';
import { Suspense } from 'react';
import { pageMetadata } from '@/lib/seo';
import JsonLd from '@/components/JsonLd';
import { marketplaceAgentsSchema, talentMarketplaceSchema } from '@/lib/structured-data';
import { publicApiGet } from '@/lib/publicApi';
import MarketplacePageClient from './MarketplacePageClient';

// Server-side data fetch (published-agents JSON-LD) must run on the edge runtime
// under @cloudflare/next-on-pages — same convention as marketplace/[slug]. The
// previous async layout omitted this, which broke the route in production while
// the fully-client page rendered fine in dev.
export const runtime = 'edge';

export const metadata: Metadata = pageMetadata({
  title: 'Workforce Marketplace — Hire, Install & Publish AI Agents, Skills & Personas',
  description:
    'Browse the Builderforce.ai Workforce Registry: hire trained AI agents, install skills and personas, and publish your own. Free to browse, zero commission on what you publish.',
  path: '/marketplace',
});

interface PublicAgent { id: string | number; name: string; description?: string | null; skills?: string[] | null; published?: boolean }
interface PublicFreelancer { userId: string; displayName?: string | null; headline?: string | null; discipline?: string | null; skills?: string[] | null }

/** Fetch published marketplace agents server-side so their tags are crawlable as
 *  JSON-LD keywords [1241]. Best-effort; failure → no JSON-LD (the client page
 *  still renders its own list after hydration). */
async function fetchPublishedAgents(): Promise<PublicAgent[]> {
  const rows = await publicApiGet<PublicAgent[]>('/api/workforce/agents');
  return Array.isArray(rows) ? rows.filter((a) => a?.published) : [];
}

/** Talent (freelancers) is now a category of this page, so its JSON-LD is emitted
 *  here too — the standalone /talent route redirects in. Best-effort. */
async function fetchPublicFreelancers(): Promise<PublicFreelancer[]> {
  const body = await publicApiGet<{ items?: PublicFreelancer[] }>('/api/freelancers?pageSize=48');
  return Array.isArray(body?.items) ? body.items : [];
}

export default async function MarketplacePage() {
  const [agents, freelancers] = await Promise.all([fetchPublishedAgents(), fetchPublicFreelancers()]);
  return (
    <>
      {agents.length > 0 && <JsonLd data={marketplaceAgentsSchema(agents)} />}
      {freelancers.length > 0 && <JsonLd data={talentMarketplaceSchema(freelancers)} />}
      {/* Suspense: MarketplacePageClient reads useSearchParams (?category=…). */}
      <Suspense fallback={null}>
        <MarketplacePageClient />
      </Suspense>
    </>
  );
}

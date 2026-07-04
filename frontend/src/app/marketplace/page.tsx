import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import JsonLd from '@/components/JsonLd';
import { marketplaceAgentsSchema, talentMarketplaceSchema } from '@/lib/structured-data';
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
  const apiBase = process.env.NEXT_PUBLIC_AUTH_API_URL || 'https://api.builderforce.ai';
  try {
    const res = await fetch(`${apiBase}/api/workforce/agents`, { next: { revalidate: 3600 } });
    if (!res.ok) return [];
    const rows = (await res.json()) as PublicAgent[];
    return Array.isArray(rows) ? rows.filter((a) => a?.published) : [];
  } catch {
    return [];
  }
}

/** Talent (freelancers) is now a category of this page, so its JSON-LD is emitted
 *  here too — the standalone /talent route redirects in. Best-effort. */
async function fetchPublicFreelancers(): Promise<PublicFreelancer[]> {
  const apiBase = process.env.NEXT_PUBLIC_AUTH_API_URL || 'https://api.builderforce.ai';
  try {
    const res = await fetch(`${apiBase}/api/freelancers?pageSize=48`, { next: { revalidate: 3600 } });
    if (!res.ok) return [];
    const body = (await res.json()) as { items?: PublicFreelancer[] };
    return Array.isArray(body.items) ? body.items : [];
  } catch {
    return [];
  }
}

export default async function MarketplacePage() {
  const [agents, freelancers] = await Promise.all([fetchPublishedAgents(), fetchPublicFreelancers()]);
  return (
    <>
      {agents.length > 0 && <JsonLd data={marketplaceAgentsSchema(agents)} />}
      {freelancers.length > 0 && <JsonLd data={talentMarketplaceSchema(freelancers)} />}
      <MarketplacePageClient />
    </>
  );
}

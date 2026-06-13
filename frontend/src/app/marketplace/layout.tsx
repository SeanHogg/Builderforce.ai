import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import JsonLd from '@/components/JsonLd';
import { marketplaceAgentsSchema } from '@/lib/structured-data';

// The marketplace page itself is a client component, so per-page metadata lives
// here in a server layout (Next.js picks up the export on the route segment).
export const metadata: Metadata = pageMetadata({
  title: 'Workforce Marketplace — Hire, Install & Publish AI Agents, Skills & Personas',
  description:
    'Browse the Builderforce.ai Workforce Registry: hire trained AI agents, install skills and personas, and publish your own. Free to browse, zero commission on what you publish.',
  path: '/marketplace',
});

interface PublicAgent { id: string | number; name: string; description?: string | null; skills?: string[] | null; published?: boolean }

/** Fetch published marketplace agents server-side so their tags are crawlable as
 *  JSON-LD keywords [1241]. Best-effort + ISR-cached; failure → no JSON-LD (the
 *  client page still renders its own list after hydration). */
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

export default async function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  const agents = await fetchPublishedAgents();
  return (
    <>
      {agents.length > 0 && <JsonLd data={marketplaceAgentsSchema(agents)} />}
      {children}
    </>
  );
}

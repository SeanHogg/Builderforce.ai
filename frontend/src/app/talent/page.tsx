import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import JsonLd from '@/components/JsonLd';
import { talentMarketplaceSchema } from '@/lib/structured-data';
import TalentMarketplaceClient from './TalentMarketplaceClient';

// Server-side data fetch (public freelancers → JSON-LD) runs on the edge runtime
// under @cloudflare/next-on-pages — same convention as /marketplace.
export const runtime = 'edge';

export const metadata: Metadata = pageMetadata({
  title: 'Talent Marketplace — Hire Freelance Developers, DBAs & Designers',
  description:
    'Hire vetted freelance developers, DBAs, designers and other specialists on Builderforce.ai. Browse résumés, skills and hourly rates, interview, and track billable hours — all in one place.',
  path: '/talent',
});

interface PublicFreelancer { userId: string; displayName?: string | null; headline?: string | null; discipline?: string | null; skills?: string[] | null }

/** Fetch published public freelancers server-side so their skills/headlines are
 *  crawlable as JSON-LD. Best-effort; failure → no JSON-LD (the client still
 *  renders the live list after hydration). */
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

export default async function TalentPage() {
  const freelancers = await fetchPublicFreelancers();
  return (
    <>
      {freelancers.length > 0 && <JsonLd data={talentMarketplaceSchema(freelancers)} />}
      <TalentMarketplaceClient />
    </>
  );
}

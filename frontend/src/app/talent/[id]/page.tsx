import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import JsonLd from '@/components/JsonLd';
import { BRAND } from '@/lib/content';
import TalentDetailClient from './TalentDetailClient';

export const runtime = 'edge';

interface PublicFreelancer {
  userId: string; displayName?: string | null; headline?: string | null; discipline?: string | null;
  bio?: string | null; skills?: string[] | null; visibility?: string; rating?: number | null; ratingCount?: number;
}

async function fetchFreelancer(id: string): Promise<PublicFreelancer | null> {
  const apiBase = process.env.NEXT_PUBLIC_AUTH_API_URL || 'https://api.builderforce.ai';
  try {
    const res = await fetch(`${apiBase}/api/freelancers/${encodeURIComponent(id)}`, { next: { revalidate: 3600 } });
    if (!res.ok) return null; // private/404 → generic metadata below
    return (await res.json()) as PublicFreelancer;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const f = await fetchFreelancer(id);
  if (!f) {
    return pageMetadata({ title: 'Freelancer profile — Talent Marketplace', description: 'Hire vetted freelance specialists on Builderforce.ai.', path: `/talent/${id}` });
  }
  const role = f.headline || f.discipline || 'Freelance specialist';
  return pageMetadata({
    title: `${f.displayName ?? 'Freelancer'} — ${role} for hire`,
    description: (f.bio || `${f.displayName ?? 'A freelancer'} is available for hire on Builderforce.ai. ${(f.skills ?? []).slice(0, 8).join(', ')}`).slice(0, 200),
    path: `/talent/${id}`,
  });
}

/** Person JSON-LD for a public freelancer profile (only when it's a public profile). */
function personSchema(f: PublicFreelancer, id: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: f.displayName ?? 'Freelancer',
    url: `${BRAND.url}/talent/${id}`,
    ...(f.headline || f.discipline ? { jobTitle: f.headline ?? f.discipline } : {}),
    ...(f.bio ? { description: f.bio } : {}),
    ...(f.skills && f.skills.length > 0 ? { knowsAbout: f.skills.join(', ') } : {}),
    ...(f.rating != null && f.ratingCount ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: f.rating, reviewCount: f.ratingCount, bestRating: 5 } } : {}),
  };
}

export default async function TalentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const f = await fetchFreelancer(id);
  return (
    <>
      {f && f.visibility === 'public' && <JsonLd data={personSchema(f, id)} />}
      <TalentDetailClient />
    </>
  );
}

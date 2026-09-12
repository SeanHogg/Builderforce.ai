import type { ReactNode } from 'react';
import { routeTeaserMetadata } from '@/lib/routeTeaserMetadata';

export const runtime = 'edge';

/**
 * The head for every seat, decided on the server. The page below is a client
 * component and cannot export `generateMetadata`; this layout has exactly one
 * page under it, so the head it declares is that page's and nobody else's.
 * The sitemap submits `/seat/<domain>` from the teaser registry — see
 * `routeTeaserMetadata`.
 */
export async function generateMetadata({ params }: { params: Promise<{ domain: string }> }) {
  const { domain } = await params;
  return routeTeaserMetadata(`/seat/${domain}`);
}

export default function SeatDomainLayout({ children }: { children: ReactNode }) {
  return children;
}

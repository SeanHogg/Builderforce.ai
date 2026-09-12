import { routeTeaserMetadata } from '@/lib/routeTeaserMetadata';
import FreelancerDisputesClient from './FreelancerDisputesClient';

/**
 * SERVER route entry for `/freelancer/disputes`. The page is the client island
 * beside it; this module exists so the route can declare a head, which a
 * `'use client'` module cannot. See `routeTeaserMetadata`.
 */
export const runtime = 'edge';

export async function generateMetadata() {
  return routeTeaserMetadata('/freelancer/disputes');
}

export default function FreelancerDisputesPage() {
  return <FreelancerDisputesClient />;
}

import { routeTeaserMetadata } from '@/lib/routeTeaserMetadata';
import FreelancerEarningsClient from './FreelancerEarningsClient';

/**
 * SERVER route entry for `/freelancer/earnings`. The page is the client island
 * beside it; this module exists so the route can declare a head, which a
 * `'use client'` module cannot. See `routeTeaserMetadata`.
 */
export const runtime = 'edge';

export async function generateMetadata() {
  return routeTeaserMetadata('/freelancer/earnings');
}

export default function FreelancerEarningsPage() {
  return <FreelancerEarningsClient />;
}

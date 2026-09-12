import { routeTeaserMetadata } from '@/lib/routeTeaserMetadata';
import InsightsHomeClient from './InsightsHomeClient';

/**
 * SERVER route entry for `/insights`. The home is the client island beside it;
 * this module exists so the route can declare a head, which a `'use client'`
 * module cannot. A page, not a layout: the lenses under `/insights/*` declare
 * their own heads, and a layout's canonical would have been inherited by any
 * that did not. See `routeTeaserMetadata`.
 */
export const runtime = 'edge';

export async function generateMetadata() {
  return routeTeaserMetadata('/insights');
}

export default function InsightsHomePage() {
  return <InsightsHomeClient />;
}

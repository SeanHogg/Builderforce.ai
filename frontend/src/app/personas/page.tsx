import { routeTeaserMetadata } from '@/lib/routeTeaserMetadata';
import RouteTeaserJsonLd from '@/components/marketing/RouteTeaserJsonLd';
import PersonasClient from './PersonasClient';

/**
 * SERVER route entry for `/personas`. The page is the client island beside it;
 * this module exists so the route can declare a head, which a `'use client'`
 * module cannot. A page, not a layout: `/personas/<slug>` declares its own
 * head, and a layout's canonical would have been inherited by any child that
 * did not. See `routeTeaserMetadata`.
 */
export const runtime = 'edge';

export async function generateMetadata() {
  return routeTeaserMetadata('/personas');
}

export default function PersonasPage() {
  return (
    <>
      <RouteTeaserJsonLd pathname="/personas" />
      <PersonasClient />
    </>
  );
}

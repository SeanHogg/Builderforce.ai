import { routeTeaserMetadata } from '@/lib/routeTeaserMetadata';
import RouteTeaserJsonLd from '@/components/marketing/RouteTeaserJsonLd';
import ContentManagerRedirect from './ContentManagerRedirect';

/**
 * SERVER route entry for `/content-manager`. The migrate-then-forward runs in
 * the client leaf beside it; this module exists so the route can declare a
 * head, which a `'use client'` module cannot. See `routeTeaserMetadata`.
 */
export const runtime = 'edge';

export async function generateMetadata() {
  return routeTeaserMetadata('/content-manager');
}

export default function ContentManagerPage() {
  return (
    <>
      <RouteTeaserJsonLd pathname="/content-manager" />
      <ContentManagerRedirect />
    </>
  );
}

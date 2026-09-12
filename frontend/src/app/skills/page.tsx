import { routeTeaserMetadata } from '@/lib/routeTeaserMetadata';
import RouteTeaserJsonLd from '@/components/marketing/RouteTeaserJsonLd';
import SkillsClient from './SkillsClient';

/**
 * SERVER route entry for `/skills`. The page is the client island beside it;
 * this module exists so the route can declare a head, which a `'use client'`
 * module cannot. A page, not a layout: `/skills/<slug>` declares its own head,
 * and a layout's canonical would have been inherited by any child that did not.
 * See `routeTeaserMetadata`.
 */
export const runtime = 'edge';

export async function generateMetadata() {
  return routeTeaserMetadata('/skills');
}

export default function SkillsPage() {
  return (
    <>
      <RouteTeaserJsonLd pathname="/skills" />
      <SkillsClient />
    </>
  );
}

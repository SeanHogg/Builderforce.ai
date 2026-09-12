import { routeTeaserMetadata } from '@/lib/routeTeaserMetadata';
import RouteTeaserJsonLd from '@/components/marketing/RouteTeaserJsonLd';
import DashboardClient from './DashboardClient';

/**
 * SERVER route entry for `/dashboard`. The page is the client island beside it;
 * this module exists so the route can declare a head, which a `'use client'`
 * module cannot. The sitemap submits this URL from the teaser registry — see
 * `routeTeaserMetadata`.
 */
export const runtime = 'edge';

export async function generateMetadata() {
  return routeTeaserMetadata('/dashboard');
}

export default function DashboardPage() {
  return (
    <>
      <RouteTeaserJsonLd pathname="/dashboard" />
      <DashboardClient />
    </>
  );
}

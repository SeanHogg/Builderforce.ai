import { routeTeaserMetadata } from '@/lib/routeTeaserMetadata';
import WorkspaceDisputesClient from './WorkspaceDisputesClient';

/**
 * SERVER route entry for `/disputes`. The page is the client island beside it;
 * this module exists so the route can declare a head, which a `'use client'`
 * module cannot. See `routeTeaserMetadata`.
 */
export const runtime = 'edge';

export async function generateMetadata() {
  return routeTeaserMetadata('/disputes');
}

export default function WorkspaceDisputesPage() {
  return <WorkspaceDisputesClient />;
}

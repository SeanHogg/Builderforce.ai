import { routeTeaserMetadata } from '@/lib/routeTeaserMetadata';
import CanvasLibraryClient from './CanvasLibraryClient';

/**
 * SERVER route entry for `/create`. The library is the client island beside it;
 * this module exists so the route can declare a head, which a `'use client'`
 * module cannot. A page, not a layout: every board under `/create/*` would
 * otherwise inherit this canonical. See `routeTeaserMetadata`.
 */
export const runtime = 'edge';

export async function generateMetadata() {
  return routeTeaserMetadata('/create');
}

export default function CanvasLibraryPage() {
  return <CanvasLibraryClient />;
}

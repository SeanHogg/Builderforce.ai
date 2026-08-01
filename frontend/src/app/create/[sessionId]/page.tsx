'use client';

import { useParams } from 'next/navigation';
import { CreationCanvas } from '@/components/creation-canvas/CreationCanvas';

// Cloudflare Pages requires every dynamic route to opt into the Edge runtime.
// Keep this beside the route (rather than relying on a parent layout) so the
// deployment adapter can statically discover it during route analysis.
export const runtime = 'edge';

export default function CreationSessionPage() {
  const params = useParams<{ sessionId: string }>();
  return <CreationCanvas sessionId={params.sessionId} />;
}

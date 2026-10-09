import type { Metadata } from 'next';
import CreationSessionClient from '@/components/canvas/CreationSessionClient';

export const runtime = 'edge';

/** Someone's own board, guest or workspace — never an indexable page. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function CreationSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <CreationSessionClient sessionId={sessionId} lens="canvas" />;
}

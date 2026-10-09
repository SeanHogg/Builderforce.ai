import CreationSessionClient from '@/components/canvas/CreationSessionClient';

export const runtime = 'edge';

export default async function CreationSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <CreationSessionClient sessionId={sessionId} lens="canvas" />;
}

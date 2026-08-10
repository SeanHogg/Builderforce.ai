import CreationSessionClient from './CreationSessionClient';

export const runtime = 'edge';

export default async function CreationSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <CreationSessionClient sessionId={sessionId} />;
}

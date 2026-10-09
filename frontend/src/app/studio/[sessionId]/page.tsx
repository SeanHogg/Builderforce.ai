import CreationSessionClient from '@/components/canvas/CreationSessionClient';

export const runtime = 'edge';

/**
 * A creation session seen through the STUDIO lens — the same board as
 * `/create/<sessionId>` (same id, same mounted canvas on the shell's stage), drawn as
 * prompt + preview. The static `project` segment beside this one keeps precedence, so
 * `/studio/project/<id>` is still the durable-project Studio IDE. See `lib/canvasLens.ts`.
 */
export default async function StudioSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <CreationSessionClient sessionId={sessionId} lens="studio" />;
}

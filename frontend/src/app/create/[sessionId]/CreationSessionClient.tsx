'use client';

import { CreationCanvas } from '@/components/creation-canvas/CreationCanvas';

export default function CreationSessionClient({ sessionId }: { sessionId: string }) {
  return <CreationCanvas sessionId={sessionId} />;
}

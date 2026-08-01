'use client';

import { useParams } from 'next/navigation';
import { CreationCanvas } from '@/components/creation-canvas/CreationCanvas';

export default function CreationSessionPage() {
  const params = useParams<{ sessionId: string }>();
  return <CreationCanvas sessionId={params.sessionId} />;
}

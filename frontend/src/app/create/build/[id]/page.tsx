import { Suspense } from 'react';
import { BuildCanvasRedirect } from '@/components/creation-canvas/BuildCanvasRedirect';

export const runtime = 'edge';

/** Canvas-native deep link for opening an existing Builder workspace. */
export default async function OpenCanvasBuildPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={null}><BuildCanvasRedirect projectRef={id} /></Suspense>;
}

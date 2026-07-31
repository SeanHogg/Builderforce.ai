'use client';

/**
 * The full-page guest Brain, rendered at /brainstorm for LOGGED-OUT visitors by
 * ConditionalAppShell (in place of the marketing teaser). Reads a one-shot
 * `?prompt=` (the homepage hero routes here) and hands it to GuestBrainPanel.
 */

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { GuestBrainPanel } from './GuestBrainPanel';

function GuestBrainstormInner() {
  const searchParams = useSearchParams();
  const initialPrompt = searchParams.get('prompt') ?? undefined;
  return (
    <div style={{ padding: '20px 16px', width: '100%', boxSizing: 'border-box' }}>
      <GuestBrainPanel variant="page" initialPrompt={initialPrompt} />
    </div>
  );
}

export function GuestBrainstormPage() {
  // useSearchParams requires a Suspense boundary under the app router.
  return (
    <Suspense fallback={null}>
      <GuestBrainstormInner />
    </Suspense>
  );
}

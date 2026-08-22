import { Suspense } from 'react';
import { BrainstormCanvasRedirect } from './BrainstormCanvasRedirect';

/** Server page; the session-dependent forward runs in the client leaf beside it. */
export default function BrainstormCompatibilityPage() {
  return <Suspense fallback={null}><BrainstormCanvasRedirect /></Suspense>;
}

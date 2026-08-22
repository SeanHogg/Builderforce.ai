import { Suspense } from 'react';
import { WorkflowBuilderCanvasRedirect } from './WorkflowBuilderCanvasRedirect';

/** Server page; the session-dependent forward runs in the client leaf beside it. */
export default function WorkflowBuilderCompatibilityPage() {
  return <Suspense fallback={null}><WorkflowBuilderCanvasRedirect /></Suspense>;
}

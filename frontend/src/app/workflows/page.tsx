import { Suspense } from 'react';
import { WorkflowsPageBody } from './WorkflowsPageBody';

/** A server component; the `?projectId=` read lives in the client leaf beside it. */
export default function WorkflowsPage() {
  return (
    <main style={{ padding: '24px 24px 48px', maxWidth: 1200, margin: '0 auto' }}>
      <Suspense fallback={null}>
        <WorkflowsPageBody />
      </Suspense>
    </main>
  );
}

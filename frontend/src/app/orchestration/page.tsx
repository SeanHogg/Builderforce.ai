import { Suspense } from 'react';
import { pageMetadata } from '@/lib/seo';
import { OrchestrationPageBody } from './OrchestrationPageBody';

export const runtime = 'edge';

export const metadata = pageMetadata({
  title: 'Live orchestration',
  description: 'In-flight agent workflows and the live DAG. Authoring stays on the canvas.',
  path: '/orchestration',
});

export default function OrchestrationPage() {
  return (
    <Suspense fallback={null}>
      <OrchestrationPageBody />
    </Suspense>
  );
}

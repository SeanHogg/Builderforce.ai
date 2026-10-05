import { Suspense } from 'react';
import { SpawnParentPage } from '@/components/spawn/SpawnParentPage';

export const runtime = 'edge';

/** The grown-up's page, reached from a trial email's signed link. Suspense for its search params. */
export default function SpawnParentRoute() {
  return (
    <Suspense fallback={null}>
      <SpawnParentPage />
    </Suspense>
  );
}

import { Suspense } from 'react';
import { SpawnAccountPage } from '@/components/spawn/SpawnAccountPage';

export const runtime = 'edge';

/** The Spawn account: age, membership, tokens and the desktop app. Suspense for its search params. */
export default function SpawnAccountRoute() {
  return (
    <Suspense fallback={null}>
      <SpawnAccountPage />
    </Suspense>
  );
}

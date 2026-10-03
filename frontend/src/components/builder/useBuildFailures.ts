// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useEffect, useState } from 'react';
import { readBuildFailures, subscribeBuildFailures, type BuildFailure } from '@/lib/buildDiagnostics';

/** The build and runtime failures recorded for a project, kept current. */
export function useBuildFailures(projectId: number): BuildFailure[] {
  const [failures, setFailures] = useState<BuildFailure[]>(() => readBuildFailures(projectId));

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFailures(readBuildFailures(projectId));
    return subscribeBuildFailures(() => setFailures(readBuildFailures(projectId)));
  }, [projectId]);

  return failures;
}

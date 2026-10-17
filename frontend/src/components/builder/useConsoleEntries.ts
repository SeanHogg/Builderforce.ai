// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useEffect, useState } from 'react';
import type { WorkspaceId } from '@/lib/workspace/workspaceId';
import { readConsoleEntries, subscribeConsoleEntries, type ConsoleEntry } from '@/lib/previewConsole';

/** The preview console recorded for a workspace, kept current (`lib/previewConsole.ts`). */
export function useConsoleEntries(projectId: WorkspaceId): ConsoleEntry[] {
  const [entries, setEntries] = useState<ConsoleEntry[]>(() => readConsoleEntries(projectId));

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEntries(readConsoleEntries(projectId));
    return subscribeConsoleEntries((changed) => {
      if (changed === projectId) setEntries(readConsoleEntries(projectId));
    });
  }, [projectId]);

  return entries;
}

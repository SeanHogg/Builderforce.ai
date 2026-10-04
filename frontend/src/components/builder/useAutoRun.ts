// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useEffect, useRef } from 'react';
import type { FileEntry } from '@/lib/types';
import type { RunPhase } from './useWorkspaceRun';

/** Long enough to let a burst of agent writes land as one run, short enough to feel immediate. */
const AUTO_RUN_DEBOUNCE_MS = 600;

/** Files a preview can start from. A project without either has nothing to show yet. */
const ENTRY_FILES = new Set(['package.json', 'index.html']);

/** Whether the project has anything a preview could start from. */
export function hasRunnableEntry(files: readonly FileEntry[]): boolean {
  return files.some((f) => f.type === 'file' && ENTRY_FILES.has(f.path));
}

/**
 * Start the preview by itself, so nobody has to find and press a Run button.
 *
 * It runs when the workspace opens and again whenever the project's files
 * change while no preview is live (the agent's first build lands, a fix lands
 * after a failure). A live preview is not restarted: edits reach it through the
 * runtime's hot reload. After a failed or blocked run it waits for the files to
 * change rather than retrying the same broken input in a loop.
 */
export function useAutoRun({ enabled, files, phase, run }: {
  enabled: boolean;
  files: FileEntry[];
  phase: RunPhase;
  run: () => Promise<void>;
}): void {
  // The files a run was last attempted with. Read after the run settles, because
  // a run can itself add files (fetched or restored scaffold) and that must not
  // count as a change worth another attempt.
  const attemptedRef = useRef<FileEntry[] | null>(null);
  const filesRef = useRef(files);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    if (!enabled || phase === 'starting' || phase === 'live') return undefined;
    if (attemptedRef.current === files || !hasRunnableEntry(files)) return undefined;
    const timer = window.setTimeout(() => {
      attemptedRef.current = files;
      void run().finally(() => { attemptedRef.current = filesRef.current; });
    }, AUTO_RUN_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, files, phase, run]);
}

// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { downloadProject } from '@/lib/workspace/downloadProject';
import type { WorkspaceFileStore } from '@/lib/workspace/workspaceFileStore';

/**
 * "Download project" as UI state: one download at a time, `busy` while the files are
 * read and zipped, and a localized `error` when it could not be prepared. `download`
 * resolves true when the browser was handed the archive.
 */
export function useDownloadProject(store: WorkspaceFileStore, name: string) {
  const t = useTranslations('ide');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A ref, not `busy`: a double click lands before the re-render that disables the button.
  const inFlight = useRef(false);

  const download = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await downloadProject(store, name);
      return true;
    } catch {
      // Shown, not swallowed: the button carries the reason until the next attempt.
      setError(t('workspace.downloadProjectFailed'));
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [store, name, t]);

  return { download, busy, error };
}

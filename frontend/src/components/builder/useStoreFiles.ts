// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useEffect, useState } from 'react';
import { faultMessage } from '@/lib/apiClient';
import type { WorkspaceFileStore } from '@/lib/workspace/workspaceFileStore';
import type { FileEntry } from '@/lib/types';

/**
 * A workspace's file list as it opens — what `useBuilderWorkspace` starts from when the
 * host has a store rather than a loaded project (the canvas App surface). `files` stays
 * null until the first read lands, so the host can show it is loading rather than an
 * empty project.
 */
export function useStoreFiles(store: WorkspaceFileStore, failedMessage: string): { files: FileEntry[] | null; error: string | null } {
  const [state, setState] = useState<{ store: WorkspaceFileStore; files: FileEntry[] | null; error: string | null }>({ store, files: null, error: null });

  useEffect(() => {
    let cancelled = false;
    store.list()
      .then((files) => { if (!cancelled) setState({ store, files, error: null }); })
      .catch((cause: unknown) => { if (!cancelled) setState({ store, files: null, error: faultMessage(cause, failedMessage) }); });
    return () => { cancelled = true; };
  }, [store, failedMessage]);

  // A different store is a different workspace: never hand it the previous one's files.
  return state.store === store ? { files: state.files, error: state.error } : { files: null, error: null };
}

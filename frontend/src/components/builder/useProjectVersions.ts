// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useCallback, useEffect, useRef, useState } from 'react';
import { projectCheckpointsApi, type ProjectCheckpoint, type ProjectCheckpointRestore } from '@/lib/api';
import { notifyWorkspaceFilesChanged, subscribeWorkspaceFiles } from '@/lib/workspaceFileEvents';

/** How long the agent's writes must pause before the burst becomes one version. */
const SETTLE_MS = 4000;
/** Our own restore announces its writes; those are not new work to version. */
const RESTORE_QUIET_MS = 3000;

export interface ProjectVersions {
  versions: ProjectCheckpoint[] | null;
  error: boolean;
  save: (name: string) => Promise<void>;
  restore: (id: number) => Promise<ProjectCheckpointRestore>;
}

/**
 * A project's versions, kept the way Bolt shows them: one per agent turn.
 *
 * Agent writes announce themselves (`workspaceFileEvents`); when a burst of them
 * settles, the paths it touched become one automatic version. The first open of
 * a project with no versions records its starting point, so the first agent turn
 * can always be undone. Restoring announces the files it put back, so the open
 * editor and preview pick them up.
 *
 * Call it ONCE per open workspace (`useBuilderWorkspace` does): it is also what
 * records versions, so a second caller would record every turn twice. A null
 * project (a workspace held in this browser, or a type without versions) is inert.
 */
export function useProjectVersions(projectId: number | null): ProjectVersions {
  const [versions, setVersions] = useState<ProjectCheckpoint[] | null>(null);
  const [error, setError] = useState(false);
  const pendingPaths = useRef(new Set<string>());
  const quietUntil = useRef(0);

  const reload = useCallback(async () => {
    if (projectId === null) return;
    try {
      setVersions(await projectCheckpointsApi.list(projectId));
      setError(false);
    } catch {
      setError(true);
    }
  }, [projectId]);

  useEffect(() => {
    if (projectId === null) return undefined;
    let cancelled = false;
    projectCheckpointsApi.list(projectId)
      .then(async (list) => {
        if (cancelled) return;
        if (list.length > 0) { setVersions(list); return; }
        await projectCheckpointsApi.create(projectId, { kind: 'baseline' });
        if (!cancelled) await reload();
      })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [projectId, reload]);

  useEffect(() => {
    if (projectId === null) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeWorkspaceFiles((changedProject, paths) => {
      if (changedProject !== projectId || Date.now() < quietUntil.current) return;
      for (const path of paths) pendingPaths.current.add(path);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const changed = [...pendingPaths.current];
        pendingPaths.current.clear();
        projectCheckpointsApi.create(projectId, { kind: 'auto', changed })
          .then(reload)
          .catch(() => setError(true));
      }, SETTLE_MS);
    });
    return () => { clearTimeout(timer); unsubscribe(); };
  }, [projectId, reload]);

  const save = useCallback(async (name: string) => {
    if (projectId === null) return;
    await projectCheckpointsApi.create(projectId, { kind: 'manual', name });
    await reload();
  }, [projectId, reload]);

  const restore = useCallback(async (id: number) => {
    if (projectId === null) throw new Error('This workspace has no versions.');
    const outcome = await projectCheckpointsApi.restore(projectId, id);
    quietUntil.current = Date.now() + RESTORE_QUIET_MS;
    notifyWorkspaceFilesChanged(projectId, [...outcome.restored, ...outcome.removed]);
    await reload();
    return outcome;
  }, [projectId, reload]);

  return { versions, error, save, restore };
}

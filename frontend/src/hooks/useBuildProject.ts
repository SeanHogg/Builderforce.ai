// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useEffect, useState } from 'react';
import { fetchFiles, fetchProject } from '@/lib/api';
import type { FileEntry, Project } from '@/lib/types';
import { faultMessage } from '@/lib/apiClient';

export interface BuildProjectState {
  project: Project | null;
  files: FileEntry[];
  error: string | null;
  /** The workspace renamed or otherwise changed the project. */
  setProject: (project: Project) => void;
}

/**
 * Load a build project and its files for `<BuilderWorkspace>`: the one load
 * every surface that opens the IDE needs (the canvas panel, the Studio app).
 * `null` id waits (a signed-out Studio page has nothing to load yet).
 */
export function useBuildProject(projectId: number | null, failedMessage: string): BuildProjectState {
  const [project, setProject] = useState<Project | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (projectId == null) return undefined;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProject(null);
    setError(null);
    Promise.all([fetchProject(projectId), fetchFiles(projectId)])
      .then(([loadedProject, loadedFiles]) => {
        if (cancelled) return;
        setProject(loadedProject);
        setFiles(loadedFiles);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(faultMessage(cause, failedMessage));
      });
    return () => { cancelled = true; };
  }, [projectId, failedMessage]);

  return { project, files, error, setProject };
}

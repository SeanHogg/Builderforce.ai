import { useCallback, useEffect, useState } from 'react';
import { fetchProjects } from '@/lib/api';
import type { Project } from '@/lib/types';

/** The tenant's projects, for the Brain's filter/assignment dropdowns and labels. */
export function useBrainProjects() {
  const [projects, setProjects] = useState<Project[]>([]);

  // Projects for the filter/assignment dropdowns.
  useEffect(() => {
    fetchProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  const projectName = useCallback(
    (id: number | null) => (id == null ? '' : (projects.find((p) => p.id === id)?.name ?? `#${id}`)),
    [projects],
  );

  return { projects, setProjects, projectName };
}

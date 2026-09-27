import { useCallback, useEffect, useRef, useState } from 'react';
import { usePolledResource } from '@/hooks/usePolledResource';
import { getProjectEvermindContributions, type ProjectEvermindContributions } from '@/lib/projectEvermindApi';

export interface ProjectEvermindActivity {
  data: ProjectEvermindContributions | null;
  /** True once the first read settled — or at once when there is no project to read. */
  loaded: boolean;
  error: boolean;
  reload: () => void;
}

/**
 * A project Evermind's live learning activity, kept current by a light poll.
 *
 * The ONE read behind every live reading of an Evermind outside the canvas board: the
 * Studio's Knowledge Map + Learnings, and the room's 3D brain. The endpoint is
 * server-cached, so a 20-second poll is cheap. `projectId` null (an Evermind not yet
 * attached to a project) reads nothing and reports loaded with no data — a dormant brain.
 */
export function useProjectEvermindActivity(projectId: number | null): ProjectEvermindActivity {
  const [data, setData] = useState<ProjectEvermindContributions | null>(null);
  const [loaded, setLoaded] = useState(projectId == null);
  const [error, setError] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (projectId == null || inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await getProjectEvermindContributions(projectId);
      setData(next);
      setError(false);
    } catch {
      setError(true);
    } finally {
      inFlight.current = false;
      setLoaded(true);
    }
  }, [projectId]);

  useEffect(() => {
    setData(null);
    setError(false);
    setLoaded(projectId == null);
    void load();
  }, [load, projectId]);

  usePolledResource(load, { intervalMs: 20_000, immediate: false, enabled: projectId != null });

  const reload = useCallback(() => { void load(); }, [load]);
  return { data, loaded, error, reload };
}

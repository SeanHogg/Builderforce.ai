import { useCallback, useState } from 'react';
import { usePolledResource } from '@/hooks/usePolledResource';
import { managerApi } from '@/lib/builderforceApi';

type ManagerOverview = Awaited<ReturnType<typeof managerApi.get>>;

/** A manual pass streams for at most this long; an evicted run resumes on the next pass. */
const STREAM_MAX_MS = 120_000;

/**
 * Keeps the manager overview live, with exactly one poll running at a time.
 *
 * • BACKGROUND: a CRON manager pass (every few minutes) must show up on an open tab,
 *   not only after "Run manager now". Only the overview moves with a pass (hosts, run
 *   targets and assignees are config read once by the page's own `load`), so one read
 *   a minute is enough.
 * • STREAM: after a manual run starts, the pass journals into the activity feed live,
 *   so the overview is read every 3 s until `lastRunAt` advances past the baseline or
 *   {@link STREAM_MAX_MS} elapses. The background poll is off meanwhile.
 *
 * Both are visibility-gated and stop on unmount (`usePolledResource`). `onDone` fires
 * when a stream ends, so the caller can clear its "running" state.
 */
export function useManagerOverviewLive(
  projectId: number | null | undefined,
  onOverview: (overview: ManagerOverview) => void,
  onDone: () => void,
): { streamUntilDone: (baseline: string | null) => void } {
  const [stream, setStream] = useState<{ baseline: string | null; startedAt: number } | null>(null);

  usePolledResource(async (signal) => {
    if (projectId == null || !stream) return;
    const finish = () => { setStream(null); onDone(); };
    try {
      const overview = await managerApi.get(projectId);
      if (signal.aborted) return;
      onOverview(overview);
      if (overview.stats.lastRunAt && overview.stats.lastRunAt !== stream.baseline) { finish(); return; }
    } finally {
      if (!signal.aborted && Date.now() - stream.startedAt > STREAM_MAX_MS) finish();
    }
  }, { intervalMs: 3000, enabled: stream != null && projectId != null, immediate: false });

  usePolledResource(async (signal) => {
    if (projectId == null) return;
    const overview = await managerApi.get(projectId);
    if (!signal.aborted) onOverview(overview);
  }, { intervalMs: 60_000, enabled: projectId != null && stream == null, immediate: false, restartKey: projectId });

  const streamUntilDone = useCallback((baseline: string | null) => {
    setStream({ baseline, startedAt: Date.now() });
  }, []);
  return { streamUntilDone };
}

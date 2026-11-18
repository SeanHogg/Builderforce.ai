/**
 * The tail of one service's output, read from the run session's log stream while
 * the logs view is mounted. Bounded: only the last {@link LOG_TAIL} lines are kept.
 * The view is keyed by service, so another service starts a fresh tail.
 */

import { useEffect, useState } from 'react';
import { recordedFailure } from '@/lib/reportError';
import type { RunLogLine, RunSession } from '@/lib/runTarget/runTarget';

export const LOG_TAIL = 200;

export function useRunLogs(session: RunSession | null, serviceId: string | null): RunLogLine[] {
  const [lines, setLines] = useState<RunLogLine[]>([]);

  useEffect(() => {
    if (!session || !serviceId) return;
    const reader = session.logs(serviceId).getReader();
    let reading = true;
    const pump = async (): Promise<void> => {
      while (reading) {
        const { done, value } = await reader.read();
        if (done) return;
        setLines((prev) => [...prev, value].slice(-LOG_TAIL));
      }
    };
    // A stream that errors ends the tail (recorded); the lines read so far stay on screen.
    void pump().catch(recordedFailure('Reading the run logs', undefined));
    return () => {
      reading = false;
      void reader.cancel().catch(recordedFailure('Closing the run logs', undefined));
    };
  }, [session, serviceId]);

  return lines;
}

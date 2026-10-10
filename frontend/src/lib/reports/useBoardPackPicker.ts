import { useEffect, useState } from 'react';
import { creationSessionsApi, type CreationSessionSummary } from '@/lib/builderforceApi';
import { getOrSetClientCached } from '@/infrastructure/http/readThrough';
import { reportSchedulesApi, type SchedulableFrame } from './reportSchedulesApi';

/*
 * No `'use client'`: a hook module (see `useReportSchedules`).
 */

const SESSIONS_KEY = 'report-schedules:sessions';
const SESSIONS_TTL_MS = 60_000;

export interface BoardPackPickerState {
  sessions: Pick<CreationSessionSummary, 'id' | 'title'>[];
  sessionsLoading: boolean;
  frames: SchedulableFrame[];
  framesLoading: boolean;
  error: unknown;
}

/**
 * The two reads behind "schedule this frame": the boards this person can open,
 * then — once one is chosen — the frames on it the server will accept as a
 * board pack's subject. Frames come from the schedule route itself rather than
 * from the session's objects, so the picker can never offer a frame POST would
 * refuse.
 *
 * `enabled` keeps the reads off until the form actually wants a board pack, so a
 * standup schedule costs no session list.
 */
export function useBoardPackPicker(sessionId: string, enabled: boolean): BoardPackPickerState {
  const [sessions, setSessions] = useState<BoardPackPickerState['sessions']>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [frames, setFrames] = useState<SchedulableFrame[]>([]);
  const [framesLoading, setFramesLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    setSessionsLoading(true);
    getOrSetClientCached(SESSIONS_KEY, () => creationSessionsApi.list('active'), { ttlMs: SESSIONS_TTL_MS })
      .then((result) => {
        if (live) setSessions((result.sessions ?? []).map(({ id, title }) => ({ id, title })));
      })
      .catch((cause: unknown) => { if (live) setError(cause); })
      .finally(() => { if (live) setSessionsLoading(false); });
    return () => { live = false; };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !sessionId) {
      setFrames([]);
      return undefined;
    }
    let live = true;
    setFramesLoading(true);
    reportSchedulesApi.boardPackFrames(sessionId)
      .then((next) => { if (live) { setFrames(next); setError(null); } })
      .catch((cause: unknown) => { if (live) setError(cause); })
      .finally(() => { if (live) setFramesLoading(false); });
    return () => { live = false; };
  }, [enabled, sessionId]);

  return { sessions, sessionsLoading, frames, framesLoading, error };
}

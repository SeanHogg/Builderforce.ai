/*
 * No `'use client'` — imported only from inside the `CreationCanvas` client
 * boundary, the same reason `canvasSurfaceActions.tsx` states in its own header.
 */
import { useCallback, useState } from 'react';
import { usePolledResource } from '@/hooks/usePolledResource';
import { ceremonySessionsApi, type CeremonySession } from '@/lib/builderforceApi';
import { faultMessage } from '@/lib/apiClient';

/**
 * The standup happening in this room, if one is.
 *
 * ── WHAT IT OWNS ─────────────────────────────────────────────────────────────
 * The BINDING between a room and a project's ceremony record, and nothing else.
 * It does not own who is in the room (the presence relay does), where they stand
 * (`roomSeating`), or which project this is (`standupProject`). One reason to
 * change: how a room attaches to a ceremony.
 *
 * ── WHY IT JOINS BUT DOES NOT START ──────────────────────────────────────────
 * Opening the room must not create a ceremony row. If it did, every glance at
 * the circle would file a standup that never happened, and the cadence numbers
 * the ceremony rollup reports would count them. So: an ALREADY-RUNNING standup
 * is joined automatically — a latecomer walks in and is recorded without
 * pressing anything, which is what "a standup just happens" means for everybody
 * except the first person — and starting one is a deliberate press by that first
 * person.
 *
 * ── WHY THE READ IS POLLED AND NOT CACHED ────────────────────────────────────
 * This is a liveness question — "is a standup running right now" — whose whole
 * value is being current, so the read-through cache would be answering with the
 * state that made it worth asking. It is bounded instead: one request every 30s
 * while the room is open with a project attached, and nothing at all when it is
 * not. The heartbeat beside it is deliberately coarser for the reason
 * `CeremonyStage` states — attendance is a question minutes wide.
 *
 * ── WHY IT NEVER RAISES OVER A LIVE ROOM ─────────────────────────────────────
 * A dropped heartbeat is recoverable (the next one lands) and a dropped status
 * read resolves itself on the next tick, so neither is surfaced. Only the two
 * DELIBERATE acts — starting and finishing — report a failure, because a person
 * pressed something and is owed an answer.
 */

/** A seat at the table, in the shape the ceremony API takes. */
export interface RoomStandupParticipant {
  kind: 'human' | 'cloud_agent' | 'host_agent';
  ref: string;
  name: string;
}

export interface RoomStandupState {
  /** The live standup for this project, or null when none is running. */
  session: CeremonySession | null;
  /** True while a deliberate act (start / finish) is in flight. */
  busy: boolean;
  /** Only ever set by a deliberate act — never by the polls. */
  error: string | null;
  /** Begin a standup for the attached project. No-op without one. */
  start: () => void;
  /** End it. The server resolves attendance and closes the record. */
  finish: () => void;
  dismissError: () => void;
}

/** How often the room asks whether a standup is running. */
const STATUS_POLL_MS = 30_000;
/**
 * How often presence is filed against the ceremony record.
 *
 * Matched to `CeremonyStage`'s own beat on purpose: two surfaces recording the
 * same person's attendance at two different rates is two answers to "how long
 * were they there", and the durations feed the ceremony rollup.
 */
const ATTENDANCE_BEAT_MS = 60_000;

export function useRoomStandup(
  projectId: number | null,
  participants: readonly RoomStandupParticipant[],
): RoomStandupState {
  const [session, setSession] = useState<CeremonySession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Is a standup running for this project? Restarting on `projectId` clears the
  // previous project's answer on its own — a room that walked to another project
  // must never keep showing the last one's session while the first read is in
  // flight.
  usePolledResource(
    async (signal) => {
      if (projectId == null) {
        setSession(null);
        return;
      }
      const detail = await ceremonySessionsApi.active(projectId, 'standup').catch(() => null);
      if (signal.aborted) return;
      setSession(detail?.session?.status === 'active' ? detail.session : null);
    },
    { intervalMs: STATUS_POLL_MS, enabled: projectId != null, restartKey: projectId },
  );

  const sessionId = session?.status === 'active' ? session.id : null;

  // "I am in the room." Records the CALLER only — the endpoint takes no identity
  // from the body — so being in the circle cannot mark anybody else present. It
  // keeps beating while the tab is hidden: a person in a live room is still there.
  usePolledResource(
    () => (sessionId ? ceremonySessionsApi.heartbeat(sessionId) : undefined),
    {
      intervalMs: ATTENDANCE_BEAT_MS,
      enabled: !!sessionId,
      pauseWhenHidden: false,
      restartKey: sessionId,
    },
  );

  const start = useCallback(() => {
    if (projectId == null || busy) return;
    setBusy(true);
    setError(null);
    ceremonySessionsApi.start(projectId, 'standup', participants.map(({ kind, ref, name }) => ({ kind, ref, name })))
      .then((detail) => setSession(detail.session?.status === 'active' ? detail.session : null))
      .catch((cause) => setError(faultMessage(cause)))
      .finally(() => setBusy(false));
  }, [busy, participants, projectId]);

  const finish = useCallback(() => {
    if (!sessionId || busy) return;
    setBusy(true);
    setError(null);
    ceremonySessionsApi.complete(sessionId)
      .then(() => setSession(null))
      .catch((cause) => setError(faultMessage(cause)))
      .finally(() => setBusy(false));
  }, [busy, sessionId]);

  const dismissError = useCallback(() => setError(null), []);

  return { session, busy, error, start, finish, dismissError };
}

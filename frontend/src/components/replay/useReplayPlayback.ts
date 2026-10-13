/**
 * Playback state for one recording: fetch the row, stream its chunks in order
 * through `replayApi`, hand the events to rrweb's `Replayer` (loaded on
 * demand), and expose play / pause / seek / speed / skip-inactivity.
 *
 * Follow mode (live, PRD 33 S5) re-reads the recording every 5 s while the tab
 * is visible and appends any new chunks to the running replayer.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { ReplayRecordingDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { usePolledResource } from '@/hooks/usePolledResource';
import { createReplayer, type ReplayerLike } from './rrwebLoader';

export const REPLAY_SPEEDS = [1, 2, 4, 8] as const;
export type PlaybackStatus = 'loading' | 'ready' | 'empty' | 'error';

const TICK_MS = 200;
const FOLLOW_POLL_MS = 5_000;

export interface ReplayPlaybackOptions {
  siteId: string;
  recordingId: string;
  /** Poll for new chunks (live follow). */
  follow?: boolean;
  /** Initial position, e.g. from a `&t=` link. */
  startAtMs?: number;
}

export interface ReplayPlayback {
  rootRef: RefObject<HTMLDivElement | null>;
  recording: ReplayRecordingDto | null;
  status: PlaybackStatus;
  error: unknown;
  playing: boolean;
  currentMs: number;
  totalMs: number;
  speed: number;
  skipInactive: boolean;
  play: () => void;
  pause: () => void;
  seek: (ms: number) => void;
  setSpeed: (speed: number) => void;
  setSkipInactive: (skip: boolean) => void;
}

export function useReplayPlayback({ siteId, recordingId, follow = false, startAtMs = 0 }: ReplayPlaybackOptions): ReplayPlayback {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const replayerRef = useRef<ReplayerLike | null>(null);
  const pendingRef = useRef<unknown[]>([]);
  const loadedRef = useRef(0);
  const busyRef = useRef(false);
  const settingsRef = useRef({ speed: 1, skipInactive: true, startAtMs });
  const [recording, setRecording] = useState<ReplayRecordingDto | null>(null);
  const [status, setStatus] = useState<PlaybackStatus>('loading');
  const [error, setError] = useState<unknown>(null);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(startAtMs);
  const [totalMs, setTotalMs] = useState(0);
  const [speed, setSpeedState] = useState(1);
  const [skipInactive, setSkipState] = useState(true);

  /** Fetch chunks `[loaded, upTo)` in order; the first batch builds the replayer. */
  const loadChunks = useCallback(async (upTo: number, isCancelled: () => boolean) => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      for (let seq = loadedRef.current; seq < upTo; seq += 1) {
        const events = await replayApi.getRecordingChunk(siteId, recordingId, seq);
        if (isCancelled()) return;
        loadedRef.current = seq + 1;
        const replayer = replayerRef.current;
        if (replayer) {
          for (const event of events) replayer.addEvent(event);
        } else {
          pendingRef.current.push(...events);
          if (pendingRef.current.length > 1 && rootRef.current) {
            const { speed: s, skipInactive: skip, startAtMs: start } = settingsRef.current;
            const created = await createReplayer(pendingRef.current, rootRef.current, { speed: s, skipInactive: skip });
            if (isCancelled()) { created.destroy(); return; }
            pendingRef.current = [];
            created.on('finish', () => setPlaying(false));
            replayerRef.current = created;
            created.pause(start);
            setStatus('ready');
          }
        }
        if (replayerRef.current) setTotalMs(replayerRef.current.getMetaData().totalTime);
      }
    } finally {
      busyRef.current = false;
    }
  }, [siteId, recordingId]);

  // One recording per mount: `ReplayPlayer` keys its body on the recording id,
  // so nothing here resets state for a different one — it only ever starts fresh.
  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    loadedRef.current = 0;
    pendingRef.current = [];
    busyRef.current = false;
    replayApi.getRecording(siteId, recordingId)
      .then(async (row) => {
        if (cancelled) return;
        setRecording(row);
        await loadChunks(row.chunkCount, isCancelled);
        if (!cancelled && !replayerRef.current) setStatus('empty');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err);
        setStatus('error');
      });
    return () => {
      cancelled = true;
      replayerRef.current?.destroy();
      replayerRef.current = null;
    };
  }, [siteId, recordingId, loadChunks]);

  // The position readout follows the replayer while it plays.
  useEffect(() => {
    if (!playing) return undefined;
    const timer = setInterval(() => {
      const replayer = replayerRef.current;
      if (replayer) setCurrentMs(replayer.getCurrentTime());
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [playing]);

  usePolledResource(async (signal) => {
    const row = await replayApi.getRecording(siteId, recordingId);
    if (signal.aborted) return;
    setRecording(row);
    if (row.chunkCount > loadedRef.current) await loadChunks(row.chunkCount, () => signal.aborted);
  }, { intervalMs: FOLLOW_POLL_MS, enabled: follow && status === 'ready', immediate: false });

  const play = useCallback(() => {
    const replayer = replayerRef.current;
    if (!replayer) return;
    const total = replayer.getMetaData().totalTime;
    const from = replayer.getCurrentTime();
    replayer.play(from >= total ? 0 : from);
    setPlaying(true);
  }, []);

  const pause = useCallback(() => {
    const replayer = replayerRef.current;
    if (!replayer) return;
    replayer.pause();
    setPlaying(false);
    setCurrentMs(replayer.getCurrentTime());
  }, []);

  const seek = useCallback((ms: number) => {
    const replayer = replayerRef.current;
    const target = Math.max(0, ms);
    setCurrentMs(target);
    if (!replayer) {
      settingsRef.current.startAtMs = target;
      return;
    }
    if (playing) replayer.play(target);
    else replayer.pause(target);
  }, [playing]);

  const setSpeed = useCallback((next: number) => {
    settingsRef.current.speed = next;
    setSpeedState(next);
    replayerRef.current?.setConfig({ speed: next });
  }, []);

  const setSkipInactive = useCallback((next: boolean) => {
    settingsRef.current.skipInactive = next;
    setSkipState(next);
    replayerRef.current?.setConfig({ skipInactive: next });
  }, []);

  return {
    rootRef, recording, status, error, playing, currentMs, totalMs, speed, skipInactive,
    play, pause, seek, setSpeed, setSkipInactive,
  };
}

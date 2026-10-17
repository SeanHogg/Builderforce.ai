/**
 * Playback state for one recording: fetch the row, stream its stored chunks
 * (`chunkSeqs`, ascending) in order through `replayApi`, hand the events to rrweb's `Replayer` (loaded on
 * demand), and expose play / pause / seek / speed / skip-inactivity.
 *
 * Follow mode (live, PRD 33 S5) asks the recording's light status read every 5 s
 * while the tab is visible, appends any new chunks to the running replayer, and
 * stops once the visit has ended.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { ReplayRecordingDto, ReplayRecordingStatusDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { usePolledResource } from '@/hooks/usePolledResource';
import { createReplayer, type ReplayerLike } from './rrwebLoader';

export const REPLAY_SPEEDS = [1, 2, 4, 8] as const;
export type PlaybackStatus = 'loading' | 'ready' | 'empty' | 'error';

const TICK_MS = 200;
const FOLLOW_POLL_MS = 5_000;

/**
 * The stored seqs to stream, ascending. A trigger-kept recording starts
 * mid-visit (its first seq is above 0), so the API's `chunkSeqs` is the truth;
 * `0..chunkCount-1` is only the fallback for a row served before that field.
 */
export function recordingSeqs(row: Pick<ReplayRecordingDto, 'chunkCount'> & { chunkSeqs?: number[] }): number[] {
  if (Array.isArray(row.chunkSeqs)) return row.chunkSeqs;
  return Array.from({ length: Math.max(0, row.chunkCount) }, (_, index) => index);
}

/** Fold a live-follow status read into the held row: new seqs appended, growing facts replaced, marks when sent. */
export function applyRecordingStatus(row: ReplayRecordingDto, update: ReplayRecordingStatusDto): ReplayRecordingDto {
  const held = recordingSeqs(row);
  const last = held.at(-1) ?? -1;
  const added = update.chunkSeqs.filter((seq) => seq > last);
  return {
    ...row,
    durationMs: update.durationMs,
    activeMs: update.activeMs,
    pageCount: update.pageCount,
    exitPath: update.exitPath,
    counts: update.counts,
    chunkCount: update.chunkCount,
    chunkSeqs: added.length ? [...held, ...added] : held,
    marks: update.marks ?? row.marks,
    ended: update.ended,
  };
}

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
  /** The replayed page's document (rrweb's same-origin sandbox), or null before it is built. */
  frameDocument: () => Document | null;
}

export function useReplayPlayback({ siteId, recordingId, follow = false, startAtMs = 0 }: ReplayPlaybackOptions): ReplayPlayback {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const replayerRef = useRef<ReplayerLike | null>(null);
  const pendingRef = useRef<unknown[]>([]);
  const loadedRef = useRef(0);
  const busyRef = useRef(false);
  const settingsRef = useRef({ speed: 1, skipInactive: true, startAtMs });
  const [recording, setRecording] = useState<ReplayRecordingDto | null>(null);
  // The follow poll reads the held row for its cursor without re-creating itself per tick.
  const recordingRef = useRef<ReplayRecordingDto | null>(null);
  const commitRecording = useCallback((next: ReplayRecordingDto) => { recordingRef.current = next; setRecording(next); }, []);
  const [status, setStatus] = useState<PlaybackStatus>('loading');
  const [error, setError] = useState<unknown>(null);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(startAtMs);
  const [totalMs, setTotalMs] = useState(0);
  const [speed, setSpeedState] = useState(1);
  const [skipInactive, setSkipState] = useState(true);

  /** Fetch the stored seqs not yet loaded, in order; the first batch builds the replayer. */
  const loadChunks = useCallback(async (seqs: readonly number[], isCancelled: () => boolean) => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      for (let index = loadedRef.current; index < seqs.length; index += 1) {
        const events = await replayApi.getRecordingChunk(siteId, recordingId, seqs[index]!);
        if (isCancelled()) return;
        loadedRef.current = index + 1;
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
        commitRecording(row);
        await loadChunks(recordingSeqs(row), isCancelled);
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
  }, [siteId, recordingId, loadChunks, commitRecording]);

  // The position readout follows the replayer while it plays.
  useEffect(() => {
    if (!playing) return undefined;
    const timer = setInterval(() => {
      const replayer = replayerRef.current;
      if (replayer) setCurrentMs(replayer.getCurrentTime());
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [playing]);

  // Live follow asks the light status read (seqs past the newest held, the facts
  // that grow, marks only when their count moved) — never the whole row — and stops
  // once the recorder has sent the visit's final chunk.
  usePolledResource(async (signal) => {
    const held = recordingRef.current;
    if (!held) return;
    const seqs = recordingSeqs(held);
    const update = await replayApi.getRecordingStatus(siteId, recordingId, { afterSeq: seqs.at(-1) ?? -1, marks: held.marks.length });
    if (signal.aborted) return;
    const next = applyRecordingStatus(held, update);
    commitRecording(next);
    const nextSeqs = recordingSeqs(next);
    if (nextSeqs.length > loadedRef.current) await loadChunks(nextSeqs, () => signal.aborted);
  }, { intervalMs: FOLLOW_POLL_MS, enabled: follow && status === 'ready' && !recording?.ended, immediate: false });

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

  const frameDocument = useCallback(() => replayerRef.current?.iframe?.contentDocument ?? null, []);

  return {
    rootRef, recording, status, error, playing, currentMs, totalMs, speed, skipInactive,
    play, pause, seek, setSpeed, setSkipInactive, frameDocument,
  };
}

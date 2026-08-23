'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * THE `MediaRecorder` SINK — one implementation, for every surface that turns a
 * live stream into a file.
 *
 * ── WHY IT IS ONE ────────────────────────────────────────────────────────────
 * There were three, and they had already drifted. `useMediaRecorder` chose from
 * three WebM codec strings and wrote straight into a project path;
 * `useCanvasMediaCapture` chose from four (it alone offered `video/mp4`),
 * re-acquired its own devices, and handed back a `File`; a third copy would have
 * arrived with whatever the next surface needed. Every one of them re-solved the
 * same four hard parts — pick a supported mime, buffer `dataavailable`, wait for
 * `stop` before reading the chunks, and stop the recorder on unmount — and each
 * one was a place for that to be got subtly wrong.
 *
 * So the acquisition layer (`mediaCapture.ts`) owns getting a stream, this owns
 * turning one into bytes, and the surfaces own what the bytes are FOR: a canvas
 * `video` object, a saved project file, a narrated walkthrough.
 *
 * ── IT OWNS NO DEVICE ────────────────────────────────────────────────────────
 * `start` takes the stream. That is deliberate and it is the whole reason this
 * composes: a talktrack records a screen capture mixed with a microphone, and a
 * recorder that acquired its own stream could never be handed one.
 */

/** What came off the wire, before anybody decides what to call it. */
export interface RecordedClip {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

export type StreamRecorderError = 'unsupported' | 'failed';

export interface StreamRecorder {
  /** This context has a `MediaRecorder` at all. */
  supported: boolean;
  recording: boolean;
  /** Milliseconds since `start`, ticking while recording. */
  elapsedMs: number;
  error: StreamRecorderError | null;
  /** Begin recording the given stream. Returns false when it could not start. */
  start: (stream: MediaStream) => boolean;
  /** Stop and resolve the recorded bytes — null when nothing was captured. */
  stop: () => Promise<RecordedClip | null>;
}

/**
 * The candidates, best first.
 *
 * WebM/VP9 before VP8 before container-default, and `video/mp4` last because only
 * Safari reports it — putting it first would hand Chrome an MP4 it can produce and
 * our own `canvasVideoRender` pipeline expects WebM from a capture.
 */
const MIME_CANDIDATES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'] as const;

/** The mime this browser will actually record, or undefined to let it choose. */
export function preferredRecordingMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported?.(candidate));
}

/** `.webm` or `.mp4` for a recorded mime — the extension the container needs. */
export function recordedClipExtension(mimeType: string): string {
  return mimeType.includes('mp4') ? 'mp4' : 'webm';
}

/** Name a recorded clip for storage. Kept here so both callers name it the same way. */
export function recordedClipToFile(clip: RecordedClip, baseName: string): File {
  return new File([clip.blob], `${baseName}.${recordedClipExtension(clip.mimeType)}`, { type: clip.mimeType });
}

/** Milliseconds between `dataavailable` events. Short enough that a crash loses a second. */
const CHUNK_MS = 1_000;

export function useStreamRecorder(): StreamRecorder {
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<StreamRecorderError | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);

  // Support is a property of the browser, so it is read after mount rather than
  // during render: a control drawn on the server and removed on the client is a
  // hydration mismatch, and the same argument `useDisplayCapture` makes.
  const [supported, setSupported] = useState(false);
  useEffect(() => { setSupported(typeof MediaRecorder !== 'undefined'); }, []);

  const clearTicker = useCallback(() => {
    if (ticker.current) clearInterval(ticker.current);
    ticker.current = null;
  }, []);

  const start = useCallback((stream: MediaStream) => {
    if (recorder.current) return false;
    setError(null);
    if (typeof MediaRecorder === 'undefined') { setError('unsupported'); return false; }
    let active: MediaRecorder;
    try {
      const mimeType = preferredRecordingMimeType();
      active = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      setError('failed');
      return false;
    }
    chunks.current = [];
    active.ondataavailable = (event) => { if (event.data.size > 0) chunks.current.push(event.data); };
    active.onerror = () => { setError('failed'); };
    recorder.current = active;
    startedAt.current = typeof performance !== 'undefined' ? performance.now() : 0;
    setElapsedMs(0);
    setRecording(true);
    ticker.current = setInterval(
      () => setElapsedMs((typeof performance !== 'undefined' ? performance.now() : 0) - startedAt.current),
      250,
    );
    try {
      active.start(CHUNK_MS);
    } catch {
      recorder.current = null;
      clearTicker();
      setRecording(false);
      setError('failed');
      return false;
    }
    return true;
  }, [clearTicker]);

  const stop = useCallback(async (): Promise<RecordedClip | null> => {
    const active = recorder.current;
    if (!active) return null;
    // The last chunk arrives WITH the stop event, so reading `chunks` before it
    // fires loses the final second of every recording.
    if (active.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        active.addEventListener('stop', () => resolve(), { once: true });
        try { active.stop(); } catch { resolve(); }
      });
    }
    const durationMs = (typeof performance !== 'undefined' ? performance.now() : 0) - startedAt.current;
    const mimeType = active.mimeType || 'video/webm';
    const blob = new Blob(chunks.current, { type: mimeType });
    chunks.current = [];
    recorder.current = null;
    clearTicker();
    setRecording(false);
    setElapsedMs(0);
    return blob.size ? { blob, mimeType, durationMs } : null;
  }, [clearTicker]);

  // A recorder that outlives its component keeps encoding into a buffer nobody
  // will ever read, holding the capture open behind it.
  useEffect(() => () => {
    const active = recorder.current;
    recorder.current = null;
    if (ticker.current) clearInterval(ticker.current);
    if (active && active.state !== 'inactive') { try { active.stop(); } catch { /* already stopped */ } }
  }, []);

  return { supported, recording, elapsedMs, error, start, stop };
}

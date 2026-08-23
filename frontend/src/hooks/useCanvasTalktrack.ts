'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CANVAS_TALKTRACK_VERSION,
  mergeTalktrackMoments,
  talktrackKeyMoments,
  type CanvasTalktrack,
  type TalktrackCue,
  type TalktrackMoment,
} from '@builderforce/creation-canvas-contract';
import { combineCaptureStreams, type CaptureErrorKind } from '@/lib/mediaCapture';
import { useCameraCapture } from '@/lib/useCameraCapture';
import { useDisplayCapture } from '@/lib/useDisplayCapture';
import { recordedClipToFile, useStreamRecorder } from '@/lib/useStreamRecorder';
import { isSpeechCaptionsSupported, useSpeechCaptions } from '@/lib/useSpeechCaptions';

export interface TalktrackRecording {
  /** The recorded walkthrough, ready for `storeCanvasMedia`. */
  file: File;
  talktrack: CanvasTalktrack;
}

export interface CanvasTalktrackCapture {
  /** This browser can record a screen at all. */
  supported: boolean;
  /** This browser can also transcribe locally — the walkthrough is captioned. */
  canTranscribe: boolean;
  recording: boolean;
  elapsedMs: number;
  /** Everything transcribed so far, oldest first. */
  cues: readonly TalktrackCue[];
  /** Only the moments a PERSON marked; derived ones are added when it stops. */
  moments: readonly TalktrackMoment[];
  /** What the narrator is saying right now, before it is final. */
  interim: string;
  error: CaptureErrorKind | null;
  /** Open the share picker and start. MUST be called from a user gesture. */
  start: () => Promise<boolean>;
  /** Mark this second as worth returning to, optionally naming a board object. */
  mark: (title: string, objectId?: string) => void;
  stop: () => Promise<TalktrackRecording | null>;
}

export interface CanvasTalktrackOptions {
  /**
   * Localized phrases that open a new topic, for the key-moment heuristic. The
   * SURFACE supplies them because only it knows the reader's locale — see
   * `talktrackKeyMoments`, which works from pauses alone when the list is empty.
   */
  openers?: readonly string[];
}

/**
 * RECORD A NARRATED WALKTHROUGH of this board.
 *
 * Four existing pieces, composed, and no fifth: the screen comes from
 * `useDisplayCapture`, the voice from `useCameraCapture` (audio only), the bytes
 * from `useStreamRecorder`, and the words from `useSpeechCaptions` — the same
 * browser-native transcription a meeting already captions itself with, so a
 * walkthrough needs no server STT and no upload to be readable.
 *
 * ── WHY BOTH CAPTURES, AND WHY THEY ARE MIXED ────────────────────────────────
 * A screen share carries the shared surface's OWN audio where the browser offers
 * it, and never the narrator. Recording the display alone gives a silent
 * walkthrough of a silent board. `combineCaptureStreams` mixes both audio tracks
 * into one, because handing `MediaRecorder` two tracks records one of them and
 * says nothing about the other.
 *
 * ── WHY THE CUE TIMES ARE INFERRED ───────────────────────────────────────────
 * The Web Speech API reports WHAT was said and never WHEN. So a cue is stamped
 * from the recording's own clock: it ends when the browser finalizes it, and it
 * starts where the previous one ended. That is exact at the boundaries the
 * chapter list is cut on — a pause between sentences is measured as the real gap
 * between them — and approximate only inside a sentence, which nothing reads.
 */
export function useCanvasTalktrack(options: CanvasTalktrackOptions = {}): CanvasTalktrackCapture {
  const { openers = [] } = options;
  const display = useDisplayCapture();
  const camera = useCameraCapture();
  const recorder = useStreamRecorder();

  const [recording, setRecording] = useState(false);
  const [cues, setCues] = useState<TalktrackCue[]>([]);
  const [moments, setMoments] = useState<TalktrackMoment[]>([]);
  const [interim, setInterim] = useState('');
  const startedAt = useRef(0);
  const recordedAt = useRef('');
  const cursor = useRef(0);
  const mixer = useRef<(() => void) | null>(null);

  // Read after mount, never during render: whether this browser has the Web Speech
  // API is a client fact, and a panel that says "this will be captioned" on the
  // server and "it will not" on the client is a hydration mismatch.
  const [canTranscribe, setCanTranscribe] = useState(false);
  useEffect(() => { setCanTranscribe(isSpeechCaptionsSupported()); }, []);

  const elapsedSeconds = useCallback(
    () => Math.max(0, ((typeof performance !== 'undefined' ? performance.now() : 0) - startedAt.current) / 1000),
    [],
  );

  useSpeechCaptions({
    enabled: recording,
    onInterim: setInterim,
    onFinal: (text) => {
      const endSeconds = elapsedSeconds();
      const startSeconds = Math.min(cursor.current, endSeconds);
      cursor.current = endSeconds;
      setInterim('');
      setCues((current) => [...current, { startSeconds, endSeconds, text }]);
    },
  });

  const releaseCaptures = useCallback(() => {
    mixer.current?.();
    mixer.current = null;
    display.stop();
    camera.stop();
  }, [camera, display]);

  const start = useCallback(async () => {
    // The screen picker FIRST and on its own await: it must be reached from the
    // gesture, and asking for the microphone ahead of it stacks two permission
    // prompts before the person has chosen what they are even sharing.
    const screen = await display.start({ audio: true, frameRate: 15 });
    if (!screen) return false;
    const voice = await camera.start({ video: false, audio: true });
    // A declined microphone is a walkthrough with no narration, which is still a
    // walkthrough. It is not a reason to throw away the screen they just shared.
    const combined = combineCaptureStreams(screen, voice);
    mixer.current = combined.dispose;
    if (!recorder.start(combined.stream)) { releaseCaptures(); return false; }
    startedAt.current = typeof performance !== 'undefined' ? performance.now() : 0;
    recordedAt.current = new Date().toISOString();
    cursor.current = 0;
    setCues([]);
    setMoments([]);
    setInterim('');
    setRecording(true);
    return true;
  }, [camera, display, recorder, releaseCaptures]);

  const mark = useCallback((title: string, objectId?: string) => {
    if (!recording) return;
    setMoments((current) => [
      ...current,
      { atSeconds: elapsedSeconds(), title: title.trim() || `${Math.round(elapsedSeconds())}s`, marked: true, ...(objectId ? { objectId } : {}) },
    ]);
  }, [elapsedSeconds, recording]);

  const stop = useCallback(async (): Promise<TalktrackRecording | null> => {
    if (!recording) return null;
    const durationSeconds = elapsedSeconds();
    const clip = await recorder.stop();
    releaseCaptures();
    setRecording(false);
    setInterim('');
    if (!clip) return null;
    // The transcript's own key moments are worked out ONCE, here, rather than on
    // every render of a panel that would recompute them while the words are still
    // arriving and re-title the chapters under the reader.
    const talktrack: CanvasTalktrack = {
      version: CANVAS_TALKTRACK_VERSION,
      recordedAt: recordedAt.current,
      durationSeconds,
      cues,
      moments: mergeTalktrackMoments(moments, talktrackKeyMoments(cues, { openers })),
    };
    return { file: recordedClipToFile(clip, `talktrack-${Date.now()}`), talktrack };
  }, [cues, elapsedSeconds, moments, openers, recorder, recording, releaseCaptures]);

  return {
    supported: recorder.supported && display.supported,
    canTranscribe,
    recording,
    elapsedMs: recorder.elapsedMs,
    cues,
    moments,
    interim,
    error: display.error ?? camera.error ?? (recorder.error === 'unsupported' ? 'unsupported' : recorder.error === 'failed' ? 'failed' : null),
    start,
    mark,
    stop,
  };
}

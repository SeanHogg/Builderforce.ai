'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CaptureError,
  acquireDisplayMedia,
  isDisplayCaptureSupported,
  onStreamEnded,
  stopStream,
  type CaptureErrorKind,
  type DisplayCaptureOptions,
} from './mediaCapture';

/**
 * Screen capture as ONE piece of state, with sinks attaching to it.
 *
 * The live session broadcasts `stream` over WebRTC; the canvas pipes the same
 * `stream` into `MediaRecorder` to store a walkthrough as a board object. Both
 * read `active` for "am I sharing?", so the two surfaces cannot disagree.
 *
 * Self-gating: `supported` is false in a context with no `getDisplayMedia` (an
 * older browser, an insecure origin, a restricted iframe), and every consumer
 * hides its control on that rather than offering a button that always fails.
 */
export interface DisplayCapture {
  /** This browser/context can capture a screen at all. */
  supported: boolean;
  /** The live capture, or null when not sharing. */
  stream: MediaStream | null;
  /** Sharing right now. */
  active: boolean;
  /** True between the gesture and the picker resolving. */
  starting: boolean;
  /** Why the last attempt failed — null after a success or a cancel. */
  error: CaptureErrorKind | null;
  /** Open the picker. Must be called from a user gesture. Resolves to the stream, or null. */
  start: (options?: DisplayCaptureOptions) => Promise<MediaStream | null>;
  stop: () => void;
}

export function useDisplayCapture(onStopped?: () => void): DisplayCapture {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<CaptureErrorKind | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Held in a ref so `stop` stays stable: consumers put it on toolbar buttons
  // and in effect cleanups, and a changing identity there re-runs both.
  const stoppedRef = useRef(onStopped);
  useEffect(() => { stoppedRef.current = onStopped; }, [onStopped]);

  const [supported, setSupported] = useState(false);
  // Support is a property of the browser, so it must not be read during render
  // on the server — that renders a control on the server that the client removes.
  useEffect(() => { setSupported(isDisplayCaptureSupported()); }, []);

  const stop = useCallback(() => {
    const current = streamRef.current;
    if (!current) return;
    streamRef.current = null;
    stopStream(current);
    setStream(null);
  }, []);

  const start = useCallback(async (options?: DisplayCaptureOptions) => {
    // A second picker while one capture is live gives the person two shares and
    // the room two video tracks; replace rather than stack.
    if (streamRef.current) stop();
    setStarting(true);
    setError(null);
    try {
      const next = await acquireDisplayMedia(options);
      streamRef.current = next;
      setStream(next);
      return next;
    } catch (failure) {
      // Cancelling the picker is an ordinary outcome, not an error to report.
      const kind = failure instanceof CaptureError ? failure.kind : 'failed';
      setError(kind === 'cancelled' ? null : kind);
      return null;
    } finally {
      setStarting(false);
    }
  }, [stop]);

  // The browser's own "Stop sharing" bar ends the track without telling us.
  // Without this the UI keeps claiming to present a screen nobody is receiving.
  useEffect(() => {
    if (!stream) return;
    const unsubscribe = onStreamEnded(stream, () => {
      streamRef.current = null;
      setStream(null);
      stoppedRef.current?.();
    });
    return unsubscribe;
  }, [stream]);

  // Release the device on unmount — a capture that outlives its owner is the
  // screen-share equivalent of a camera light that never goes off.
  useEffect(() => () => { stopStream(streamRef.current); streamRef.current = null; }, []);

  return { supported, stream, active: stream != null, starting, error, start, stop };
}

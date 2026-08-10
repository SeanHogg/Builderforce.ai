'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CaptureError,
  acquireUserMedia,
  isUserMediaSupported,
  stopStream,
  type CaptureErrorKind,
} from './mediaCapture';

/**
 * Camera + microphone as ONE piece of state, with sinks attaching to it.
 *
 * The same split as {@link useDisplayCapture}: `useMediaRoom` publishes the
 * stream to peers and a recorder writes it to an artifact — two sinks, one
 * acquisition, so "is my camera on?" has a single answer.
 *
 * Track ENABLEMENT is the mute mechanism rather than re-acquisition: stopping
 * and re-getting a camera to unmute re-prompts on some browsers and always
 * flickers the device light, and a renegotiation would be needed to republish
 * the new track to every peer.
 */
export interface CameraCapture {
  supported: boolean;
  stream: MediaStream | null;
  active: boolean;
  starting: boolean;
  error: CaptureErrorKind | null;
  camOn: boolean;
  micOn: boolean;
  /** Acquire (or return the existing) camera/mic stream. */
  start: (constraints?: { video?: boolean; audio?: boolean }) => Promise<MediaStream | null>;
  stop: () => void;
  setCam: (on: boolean) => void;
  setMic: (on: boolean) => void;
}

export function useCameraCapture(): CameraCapture {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<CaptureErrorKind | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const streamRef = useRef<MediaStream | null>(null);

  const [supported, setSupported] = useState(false);
  useEffect(() => { setSupported(isUserMediaSupported()); }, []);

  const stop = useCallback(() => {
    const current = streamRef.current;
    if (!current) return;
    streamRef.current = null;
    stopStream(current);
    setStream(null);
    setCamOn(false);
  }, []);

  const start = useCallback(async (constraints?: { video?: boolean; audio?: boolean }) => {
    if (streamRef.current) return streamRef.current;
    const video = constraints?.video ?? true;
    const audio = constraints?.audio ?? true;
    setStarting(true);
    setError(null);
    try {
      const next = await acquireUserMedia({ video, audio });
      streamRef.current = next;
      setStream(next);
      setCamOn(video && next.getVideoTracks().length > 0);
      setMicOn(audio && next.getAudioTracks().length > 0);
      return next;
    } catch (failure) {
      setError(failure instanceof CaptureError ? failure.kind : 'failed');
      return null;
    } finally {
      setStarting(false);
    }
  }, []);

  const setCam = useCallback((on: boolean) => {
    const current = streamRef.current;
    if (!current) return;
    for (const track of current.getVideoTracks()) track.enabled = on;
    setCamOn(on);
  }, []);

  const setMic = useCallback((on: boolean) => {
    const current = streamRef.current;
    if (!current) return;
    for (const track of current.getAudioTracks()) track.enabled = on;
    setMicOn(on);
  }, []);

  useEffect(() => () => { stopStream(streamRef.current); streamRef.current = null; }, []);

  return { supported, stream, active: stream != null, starting, error, camOn, micOn, start, stop, setCam, setMic };
}

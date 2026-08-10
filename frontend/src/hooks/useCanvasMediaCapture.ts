'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type CanvasCaptureMode = 'screen' | 'camera';

function preferredRecorderMime(): string {
  return ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
    .find((mime) => MediaRecorder.isTypeSupported?.(mime)) ?? 'video/webm';
}

export function useCanvasMediaCapture() {
  const [mode, setMode] = useState<CanvasCaptureMode | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    recorder.current = null;
    chunks.current = [];
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async (nextMode: CanvasCaptureMode) => {
    setError(null);
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices) {
      setError('unsupported');
      return;
    }
    try {
      const nextStream = nextMode === 'screen'
        ? await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true })
        : await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      const nextRecorder = new MediaRecorder(nextStream, { mimeType: preferredRecorderMime() });
      chunks.current = [];
      nextRecorder.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
      nextRecorder.start(500);
      stream.current = nextStream;
      recorder.current = nextRecorder;
      startedAt.current = performance.now();
      setMode(nextMode);
      setDurationMs(0);
      timer.current = setInterval(() => setDurationMs(performance.now() - startedAt.current), 250);
    } catch (cause) {
      setError(cause instanceof Error && cause.name !== 'NotAllowedError' ? cause.message : 'cancelled');
      cleanup();
    }
  }, [cleanup]);

  const stop = useCallback(async (): Promise<File | null> => {
    const active = recorder.current;
    if (!active) return null;
    if (active.state !== 'inactive') await new Promise<void>((resolve) => {
      active.addEventListener('stop', () => resolve(), { once: true });
      active.stop();
    });
    const mime = active.mimeType || 'video/webm';
    const blob = new Blob(chunks.current, { type: mime });
    const capturedMode = mode ?? 'screen';
    cleanup();
    setMode(null);
    return blob.size ? new File([blob], `${capturedMode}-${Date.now()}.${mime.includes('mp4') ? 'mp4' : 'webm'}`, { type: mime }) : null;
  }, [cleanup, mode]);

  return {
    isSupported: typeof MediaRecorder !== 'undefined' && typeof navigator !== 'undefined' && !!navigator.mediaDevices,
    mode,
    durationMs,
    error,
    start,
    stop,
  };
}


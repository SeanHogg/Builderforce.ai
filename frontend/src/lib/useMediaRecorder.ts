'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { saveBinaryFile } from './api';

export interface SavedMediaRecording {
  projectId: number;
  path: string;
  mimeType: string;
  size: number;
}

/** A sink for an already-acquired camera or display stream. Owns no device. */
export function useMediaRecorderSink(
  stream: MediaStream | null,
  projectId: number | null,
  onSaved?: (recording: SavedMediaRecording) => void,
) {
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const savedRef = useRef(onSaved);
  useEffect(() => { savedRef.current = onSaved; }, [onSaved]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  const start = useCallback(() => {
    if (!stream || projectId == null || typeof MediaRecorder === 'undefined' || recorderRef.current) return;
    setError(null);
    chunksRef.current = [];
    const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => { if (event.data.size > 0) chunksRef.current.push(event.data); };
    recorder.onerror = () => { setError('recording_failed'); setRecording(false); recorderRef.current = null; };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'video/webm' });
      chunksRef.current = [];
      recorderRef.current = null;
      setRecording(false);
      setSaving(true);
      const path = `recordings/live-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
      void saveBinaryFile(projectId, path, blob)
        .then(() => savedRef.current?.({ projectId, path, mimeType: blob.type, size: blob.size }))
        .catch(() => setError('save_failed'))
        .finally(() => setSaving(false));
    };
    recorder.start(1_000);
    setRecording(true);
  }, [projectId, stream]);

  useEffect(() => () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  return { supported: typeof MediaRecorder !== 'undefined' && stream != null && projectId != null, recording, saving, error, start, stop };
}

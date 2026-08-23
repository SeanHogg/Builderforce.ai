'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { saveBinaryFile } from './api';
import { recordedClipExtension, useStreamRecorder } from './useStreamRecorder';

export interface SavedMediaRecording {
  projectId: number;
  path: string;
  mimeType: string;
  size: number;
}

/**
 * A sink for an already-acquired camera or display stream, written into the
 * project's own workspace. Owns no device and no encoder.
 *
 * The encoder moved to `useStreamRecorder` — this is now only the half that is
 * actually about a project: where the file lands, and telling the caller once it
 * has. It kept its own `saving` and `error` because a WRITE can fail long after a
 * recording succeeded, and the live session distinguishes the two in its UI.
 */
export function useMediaRecorderSink(
  stream: MediaStream | null,
  projectId: number | null,
  onSaved?: (recording: SavedMediaRecording) => void,
) {
  // Destructured rather than held as one object: `elapsedMs` ticks four times a
  // second, so depending on the recorder itself would give this hook's `start` and
  // `stop` a new identity four times a second and re-run every effect holding them.
  const { supported, recording, error: recorderError, start: startRecording, stop: stopRecording } = useStreamRecorder();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<'recording_failed' | 'save_failed' | null>(null);
  const savedRef = useRef(onSaved);
  useEffect(() => { savedRef.current = onSaved; }, [onSaved]);

  const start = useCallback(() => {
    if (!stream || projectId == null) return;
    setError(null);
    startRecording(stream);
  }, [projectId, startRecording, stream]);

  const stop = useCallback(() => {
    if (!recording) return;
    setSaving(true);
    void stopRecording().then(async (clip) => {
      if (!clip || projectId == null) return;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const path = `recordings/live-${stamp}.${recordedClipExtension(clip.mimeType)}`;
      await saveBinaryFile(projectId, path, clip.blob);
      savedRef.current?.({ projectId, path, mimeType: clip.mimeType, size: clip.blob.size });
    }).catch(() => setError('save_failed')).finally(() => setSaving(false));
  }, [projectId, recording, stopRecording]);

  return {
    supported: supported && stream != null && projectId != null,
    recording,
    saving,
    // A failed encoder and a failed upload are different problems with different
    // remedies, so they stay distinguishable rather than collapsing into "failed".
    error: recorderError === 'failed' ? 'recording_failed' as const : error,
    start,
    stop,
  };
}

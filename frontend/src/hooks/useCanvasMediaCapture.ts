'use client';

import { useCallback, useState } from 'react';
import { useCameraCapture } from '@/lib/useCameraCapture';
import { useDisplayCapture } from '@/lib/useDisplayCapture';
import { recordedClipToFile, useStreamRecorder } from '@/lib/useStreamRecorder';
import type { CaptureErrorKind } from '@/lib/mediaCapture';

export type CanvasCaptureMode = 'screen' | 'camera';

/**
 * "Record a clip straight onto this card" — the capture behind `CanvasVideoEditor`.
 *
 * It used to call `getDisplayMedia`/`getUserMedia` and drive a `MediaRecorder`
 * itself, which made it a fourth acquisition and a third encoder in a codebase
 * whose media layer says, at the top of `mediaCapture.ts`, that there is one of
 * each. It is now the composition it should always have been: `useDisplayCapture`
 * or `useCameraCapture` gets the stream, `useStreamRecorder` turns it into bytes,
 * and this owns only the one thing neither of them can know — which of the two
 * modes the person picked, which is what names the file.
 *
 * Its public shape is unchanged, so the editor did not have to be touched.
 */
export function useCanvasMediaCapture() {
  const [mode, setMode] = useState<CanvasCaptureMode | null>(null);
  const display = useDisplayCapture();
  const camera = useCameraCapture();
  const recorder = useStreamRecorder();

  const start = useCallback(async (nextMode: CanvasCaptureMode) => {
    const stream = nextMode === 'screen'
      ? await display.start({ audio: true, frameRate: 30 })
      : await camera.start({ video: true, audio: true });
    // Null is a declined permission or a cancelled picker — the hooks have already
    // recorded which, and a cancel is not an error to report.
    if (!stream) return;
    if (recorder.start(stream)) setMode(nextMode);
    else if (nextMode === 'screen') display.stop(); else camera.stop();
  }, [camera, display, recorder]);

  const stop = useCallback(async (): Promise<File | null> => {
    const captured = mode ?? 'screen';
    const clip = await recorder.stop();
    display.stop();
    camera.stop();
    setMode(null);
    // `Date.now()` rather than a counter: two clips recorded from the same card
    // must not collide on a storage key, and the second is what tells them apart.
    return clip ? recordedClipToFile(clip, `${captured}-${Date.now()}`) : null;
  }, [camera, display, mode, recorder]);

  const error: CaptureErrorKind | null = display.error ?? camera.error
    ?? (recorder.error === 'unsupported' ? 'unsupported' : recorder.error === 'failed' ? 'failed' : null);

  return {
    isSupported: recorder.supported && (display.supported || camera.supported),
    mode,
    durationMs: recorder.elapsedMs,
    error,
    start,
    stop,
  };
}

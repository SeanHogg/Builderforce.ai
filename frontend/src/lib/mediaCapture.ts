/**
 * Media acquisition — ONE layer that owns getting a `MediaStream` out of the
 * browser, so every sink attaches to the same answer.
 *
 * Before this there were two independent acquisitions and no screen capture at
 * all: `useMediaRoom` called `getUserMedia` inside its connect effect and
 * `captureAudio` called it again for the recorder, while `getDisplayMedia`
 * appeared nowhere in `frontend/src` — so the product could neither present a
 * screen in a call nor record a walkthrough onto a board.
 *
 * Two workstreams need the same stream: the live session broadcasts it over
 * WebRTC, and the canvas pipes it to `MediaRecorder` for a video object. Two
 * `getDisplayMedia` call sites is how a product ends up with two answers to "am
 * I sharing?" — the same argument `useMediaRoom` makes against a second WebRTC
 * stack. Acquisition, permission state and track-stop cleanup live here;
 * broadcasting and recording are sinks that attach to what this returns.
 *
 * Deliberately free of React so the non-hook consumers (`captureAudio`, and the
 * async connect effect inside `useMediaRoom`) share it too, and so the error
 * classification is unit-testable without mounting anything.
 */

/** Why an acquisition failed, in terms a UI can act on. */
export type CaptureErrorKind =
  /** The browser has no such API (old browser, or an insecure/framed context). */
  | 'unsupported'
  /** The person declined the permission prompt, or policy blocks it. */
  | 'denied'
  /** No matching device exists (no camera, no microphone). */
  | 'missing'
  /** A device exists but another application holds it. */
  | 'in-use'
  /** The person opened the picker and cancelled without choosing a surface. */
  | 'cancelled'
  | 'failed';

export interface CaptureFailure {
  kind: CaptureErrorKind;
  /** The browser's own message, kept for diagnostics — never shown raw to a user. */
  detail: string;
}

/** True when this context can capture a screen/window/tab. */
export function isDisplayCaptureSupported(): boolean {
  return typeof navigator !== 'undefined'
    && typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

/** True when this context can capture a camera/microphone. */
export function isUserMediaSupported(): boolean {
  return typeof navigator !== 'undefined'
    && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

/**
 * Classify a media error.
 *
 * `NotAllowedError` covers BOTH "you said no" and "you closed the picker", and
 * only the surrounding call knows which — a cancelled screen picker is an
 * ordinary outcome, a denied camera is a permission problem worth explaining.
 * `cancellable` lets the display path say so without a second classifier.
 */
export function classifyCaptureError(error: unknown, cancellable = false): CaptureFailure {
  const name = error && typeof error === 'object' && 'name' in error ? String((error as { name: unknown }).name) : '';
  const detail = error instanceof Error && error.message ? error.message : String(name || error || '');
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return { kind: cancellable ? 'cancelled' : 'denied', detail };
    case 'NotFoundError':
    case 'OverconstrainedError':
    case 'DevicesNotFoundError':
      return { kind: 'missing', detail };
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return { kind: 'in-use', detail };
    case 'TypeError':
      // The API itself is absent/unusable in this context (framed, insecure).
      return { kind: 'unsupported', detail };
    default:
      return { kind: 'failed', detail };
  }
}

/** Thrown by the acquire helpers so callers get a classified failure, not a raw DOMException. */
export class CaptureError extends Error {
  readonly kind: CaptureErrorKind;
  constructor(failure: CaptureFailure) {
    super(failure.detail || failure.kind);
    this.name = 'CaptureError';
    this.kind = failure.kind;
  }
}

export interface DisplayCaptureOptions {
  /**
   * Capture the audio of the shared surface (tab audio, system audio) where the
   * browser offers it. Best-effort by contract: Safari and Firefox ignore it,
   * and a caller must never assume an audio track came back.
   */
  audio?: boolean;
  /** Frame rate ceiling. A shared editor reads fine well below video rates. */
  frameRate?: number;
}

/**
 * Acquire a screen/window/tab stream.
 *
 * MUST be called synchronously from a user gesture — browsers reject an
 * ungestured picker, and the rejection is indistinguishable from a decline.
 */
export async function acquireDisplayMedia(options: DisplayCaptureOptions = {}): Promise<MediaStream> {
  if (!isDisplayCaptureSupported()) throw new CaptureError({ kind: 'unsupported', detail: 'getDisplayMedia unavailable' });
  const { audio = true, frameRate = 15 } = options;
  try {
    return await navigator.mediaDevices.getDisplayMedia({ video: { frameRate }, audio });
  } catch (error) {
    const failure = classifyCaptureError(error, true);
    // Some browsers reject the whole call when system audio is unsupported
    // rather than returning video alone. Retry video-only before giving up, so
    // "your browser will not share tab audio" never reads as "sharing failed".
    if (audio && failure.kind !== 'cancelled') {
      try {
        return await navigator.mediaDevices.getDisplayMedia({ video: { frameRate } });
      } catch (retryError) {
        throw new CaptureError(classifyCaptureError(retryError, true));
      }
    }
    throw new CaptureError(failure);
  }
}

/** Acquire a camera/microphone stream. */
export async function acquireUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
  if (!isUserMediaSupported()) throw new CaptureError({ kind: 'unsupported', detail: 'getUserMedia unavailable' });
  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (error) {
    throw new CaptureError(classifyCaptureError(error));
  }
}

/**
 * Stop every track and release the device.
 *
 * The single most-forgotten line in media code: without it the camera light
 * stays on after the component unmounts, which users read — correctly — as the
 * app still watching them.
 */
export function stopStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try { track.stop(); } catch { /* already ended */ }
  }
}

/**
 * Call `onEnded` when the person stops the capture from the BROWSER's own UI
 * ("Stop sharing" in the Chrome bar) rather than from ours. Returns an
 * unsubscribe. Without this the app keeps claiming to present a screen that is
 * no longer being sent.
 */
export function onStreamEnded(stream: MediaStream, onEnded: () => void): () => void {
  const tracks = stream.getTracks();
  const handler = () => onEnded();
  for (const track of tracks) track.addEventListener('ended', handler);
  return () => { for (const track of tracks) track.removeEventListener('ended', handler); };
}

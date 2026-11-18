/**
 * Ask a script running INSIDE a preview page a question, from the host page — the one
 * transport behind the review probe (`runPreviewProbe.ts`) and the preview capture
 * (`previewCapture/capturePreview.ts`).
 *
 * The preview is on another origin, so the host can neither read nor paint its frame.
 * Instead it loads the page in a hidden frame at the size it wants (parked off-screen
 * at its real size — `display: none` has no layout), posts a request, and waits for the
 * page's own script to answer with `window.parent.postMessage`. The request is
 * re-posted until answered, because "the app has booted and the script is listening"
 * has no event the host can observe across origins.
 */

export interface PreviewFrameRequest<T> {
  /** The page to load. */
  url: string;
  width: number;
  height: number;
  /** The message posted into the page (an `id` is added). */
  message: Record<string, unknown>;
  /** The answer for request `id`, an in-page failure, or undefined for any other message. */
  parse(data: unknown, id: string): { ok: true; value: T } | { ok: false; error: string } | undefined;
  /** What a timeout rejects with. */
  timeoutMessage: string;
  timeoutMs?: number;
  /** A title for the hidden frame (never shown). */
  title: string;
}

const RETRY_MS = 400;
/** `load` fires once the entry modules ran; the first render lands just after it. */
const SETTLE_MS = 600;
const DEFAULT_TIMEOUT_MS = 15_000;

const requestId = (): string =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/**
 * The origin the frame must answer from. The request goes ONLY to it, and only its
 * answers count: a frame that navigated elsewhere (a link, a redirect the app's code
 * chose) can neither read the request nor forge a reply.
 */
export function previewOrigin(url: string): string {
  return new URL(url, typeof location !== 'undefined' ? location.href : undefined).origin;
}

export function askPreviewFrame<T>(request: PreviewFrameRequest<T>, failurePrefix: string): Promise<T> {
  const id = requestId();
  const origin = previewOrigin(request.url);
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.title = request.title;
  frame.style.cssText = `position:fixed;left:-100000px;top:0;width:${request.width}px;height:${request.height}px;border:0;pointer-events:none;`;

  return new Promise<T>((resolve, reject) => {
    let retry: number | undefined;
    let settle: number | undefined;
    const finish = (outcome: () => void) => {
      window.clearTimeout(settle);
      window.clearInterval(retry);
      window.clearTimeout(deadline);
      window.removeEventListener('message', onMessage);
      frame.remove();
      outcome();
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.origin !== origin) return;
      const result = request.parse(event.data, id);
      if (result === undefined) return;
      if (result.ok) finish(() => resolve(result.value));
      else finish(() => reject(new Error(`${failurePrefix}: ${result.error}`)));
    };
    const deadline = window.setTimeout(() => finish(() => reject(new Error(request.timeoutMessage))), request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const ask = () => frame.contentWindow?.postMessage({ ...request.message, id }, origin);

    window.addEventListener('message', onMessage);
    frame.addEventListener('load', () => {
      settle = window.setTimeout(() => {
        ask();
        retry = window.setInterval(ask, RETRY_MS);
      }, SETTLE_MS);
    }, { once: true });
    frame.src = request.url;
    document.body.appendChild(frame);
  });
}

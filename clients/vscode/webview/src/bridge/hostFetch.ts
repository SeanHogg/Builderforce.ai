/**
 * A STREAMING fetch performed by the host on the webview's behalf.
 *
 * The webview reaches the gateway directly over HTTPS, but it cannot reach a model
 * runtime on `http://127.0.0.1` — a plain-HTTP localhost origin is blocked by the
 * webview's CSP, and the runtime would have to allow the `vscode-webview://` origin by
 * CORS besides (FreeToken's default `--cors-origins` does not). The extension host has
 * neither problem: it is an ordinary Node process on the same machine.
 *
 * So the request crosses the bridge and the RESPONSE BODY is streamed back in chunks,
 * reassembled here into a real `Response`. That shape is deliberate: `BrainTransport.fetch`
 * requires a `Response` whose `body` is a readable stream of the raw SSE bytes, so the
 * shared `streamChatCompletion` drives a local runtime with no idea it is being proxied —
 * the same streamer, the same tool-call protocol, the same error mapping.
 *
 * Buffering matters: chunks can arrive before the consumer starts reading, so anything
 * that lands before `start()` is queued rather than dropped.
 *
 * Import from `./vscodeBridge`, which re-exports {@link hostFetch}.
 */

import { handleFrame, nextId, onTeardown, post } from './bridgeTransport';

type HostStream = {
  open: (status: number, statusText: string, headers: Record<string, string>) => void;
  chunk: (text: string) => void;
  end: () => void;
  error: (message: string) => void;
};
const hostStreams = new Map<string, HostStream>();

export function hostFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const id = nextId('s');
  return new Promise<Response>((resolve, reject) => {
    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    const queued: string[] = [];
    let ended = false;
    let failure: string | null = null;

    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
        for (const text of queued) c.enqueue(encoder.encode(text));
        queued.length = 0;
        if (failure) c.error(new Error(failure));
        else if (ended) c.close();
      },
      cancel() {
        post('llm.abort', { id });
        hostStreams.delete(id);
      },
    });

    hostStreams.set(id, {
      open: (status, statusText, headers) => resolve(new Response(body, { status, statusText, headers })),
      chunk: (text) => {
        if (controller) controller.enqueue(encoder.encode(text));
        else queued.push(text);
      },
      end: () => {
        ended = true;
        controller?.close();
        hostStreams.delete(id);
      },
      error: (message) => {
        failure = message;
        // Before `open` the promise is still unsettled, so the failure is the rejection;
        // after it, the consumer already holds the Response and learns via the body.
        if (controller) controller.error(new Error(message));
        reject(new Error(message));
        hostStreams.delete(id);
      },
    });

    if (init.signal) {
      if (init.signal.aborted) post('llm.abort', { id });
      else init.signal.addEventListener('abort', () => post('llm.abort', { id }), { once: true });
    }

    post('llm.fetch', {
      id,
      url,
      method: init.method ?? 'GET',
      headers: (init.headers as Record<string, string> | undefined) ?? {},
      body: typeof init.body === 'string' ? init.body : null,
    });
  });
}

// Fail every in-flight stream when the webview is torn down.
onTeardown(() => {
  for (const id of [...hostStreams.keys()]) hostStreams.get(id)?.error('webview closed');
});

// Frames of a host-performed fetch: headers first, then body chunks, then a
// terminator. Unknown ids are ignored — a stream the webview already cancelled can
// still have frames in flight.
handleFrame(['llm.open', 'llm.chunk', 'llm.end', 'llm.error'], (m) => {
  const stream = m.id ? hostStreams.get(m.id) : undefined;
  if (!stream) return;
  const frame = m as unknown as {
    status?: number; statusText?: string; headers?: Record<string, string>; text?: string; error?: string;
  };
  if (m.type === 'llm.open') stream.open(frame.status ?? 200, frame.statusText ?? '', frame.headers ?? {});
  else if (m.type === 'llm.chunk') stream.chunk(frame.text ?? '');
  else if (m.type === 'llm.end') stream.end();
  else stream.error(frame.error || 'host fetch failed');
});

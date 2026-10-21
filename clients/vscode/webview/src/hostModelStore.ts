/**
 * The webview's `hf-file` model store — a VIEW of the extension host's file cache, the
 * ONE copy of a Bonsai GGUF in the editor (`src/pageEngineBridgeProtocol.ts`, model-file
 * frames). A picker download asks the host to fetch the file into its cache; `bfi` in
 * this webview loads it back from the host, a chunk per request (back-pressured: the
 * next chunk is asked for only when the engine has taken the last), so nothing is
 * fetched from Hugging Face twice and the webview never holds the whole file.
 *
 * Pure over an injected bridge, so it is unit tested without a webview.
 */
import type { HfModelStore } from '@seanhogg/builderforce-brain-embedded';
import type { ModelFileEvent, ModelFileResults } from '../../src/pageEngineBridgeProtocol';

type RequestType = keyof ModelFileResults;

export interface HostModelStoreBridge {
  request<T extends RequestType>(type: T, payload: Record<string, unknown>): Promise<ModelFileResults[T]>;
  post(type: 'modelFile.close' | 'modelFile.cancel', payload: { handle: string }): void;
  /** Subscribe to the host's download events; returns the unsubscribe. */
  onEvent(listener: (event: ModelFileEvent) => void): () => void;
}

export function createHostModelStore(bridge: HostModelStoreBridge): HfModelStore {
  return {
    async status(ref) {
      try {
        return await bridge.request('modelFile.status', { ref });
      } catch {
        return 'absent';
      }
    },

    async open(ref) {
      const { handle, bytes } = await bridge.request('modelFile.open', { ref });
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const chunk = await bridge.request('modelFile.read', { handle });
          if (!chunk || chunk.byteLength === 0) controller.close();
          else controller.enqueue(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBufferLike));
        },
        cancel() {
          bridge.post('modelFile.close', { handle });
        },
      });
      return { stream, bytes };
    },

    async download(ref, onProgress, signal) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      // Unique across every panel the host serves (the host keys its downloads by it).
      const handle = `d-${crypto.randomUUID()}`;
      await new Promise<void>((resolve, reject) => {
        const off = bridge.onEvent((event) => {
          if (event.handle !== handle) return;
          if (event.type === 'modelFile.progress') {
            onProgress?.(event.fraction);
            return;
          }
          off();
          signal?.removeEventListener('abort', abort);
          if (event.ok) resolve();
          else reject(new Error(event.error ?? 'download_failed'));
        });
        const abort = (): void => bridge.post('modelFile.cancel', { handle });
        signal?.addEventListener('abort', abort, { once: true });
        // Listening already, so the download's events cannot outrun this request.
        bridge.request('modelFile.download', { ref, handle }).catch((e: unknown) => {
          off();
          signal?.removeEventListener('abort', abort);
          reject(e instanceof Error ? e : new Error(String(e)));
        });
      });
    },

    async remove(ref) {
      await bridge.request('modelFile.remove', { ref });
    },
  };
}

/**
 * The host half of the model-file frames (`pageEngineBridgeProtocol.ts`): the chat
 * webview's `bfi` model store is a view of this file cache, so in the editor a model is
 * downloaded ONCE — here — and both the webview's engine (streaming the bytes back) and
 * the host's own `bfi` worker load the same file.
 *
 * Reads are pulled a chunk per request (the webview asks for the next only when its
 * engine took the last), so a gigabyte never queues up in the webview. A download runs
 * here and reports progress as events; `onChange` fires after every download or removal
 * (the host worker re-reads its cache). `modelFile.support` answers the host worker's
 * support record (`support`), so the webview's picker can offer a model that only the
 * host's CPU engine can run.
 *
 * Node only (through `FileModelStore`) — never imported by a webview-reachable file.
 */
import {
  isModelFileRequest,
  type ModelFileEvent,
  type ModelFileRequest,
  type ModelFileResults,
} from "../pageEngineBridgeProtocol";
import type { LocalDeviceSupport } from "@builderforce/local-inference";
import type { FileModelStore } from "./modelFiles";

export interface ModelFileIo {
  respond(id: string | undefined, ok: boolean, result?: unknown, error?: string): void;
  post(message: ModelFileEvent): void;
  /** Who asked (a panel): its open reads close when it goes ({@link ModelFileServer.release}). */
  owner?: object;
}

export interface ModelFileServer {
  /** Answer one webview frame; false when it is not a model-file frame. */
  handle(message: unknown, io: ModelFileIo): boolean;
  /** `owner` went away (its panel closed or its webview reloaded): close its open reads —
   *  a load it abandoned must not hold the file open. Its downloads carry on (the cache
   *  is shared). */
  release(owner: object): void;
  /** Close every open read and cancel every download (the extension deactivates). */
  dispose(): void;
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function createModelFileServer(
  store: FileModelStore,
  onChange: () => void,
  support: () => Promise<LocalDeviceSupport> = () => Promise.reject(new Error("no bfi engine on this host")),
): ModelFileServer {
  let seq = 0;
  const reads = new Map<string, { reader: ReadableStreamDefaultReader<Uint8Array>; owner?: object }>();
  const close = (handle: string): void => {
    const entry = reads.get(handle);
    reads.delete(handle);
    void entry?.reader.cancel().catch(() => undefined);
  };
  const downloads = new Map<string, AbortController>();
  const newHandle = (kind: string): string => `${kind}${++seq}`;

  async function answer(request: ModelFileRequest, io: ModelFileIo): Promise<ModelFileResults[keyof ModelFileResults] | undefined> {
    switch (request.type) {
      case "modelFile.status":
        return store.status(request.ref);
      case "modelFile.open": {
        const { stream, bytes } = await store.open(request.ref);
        const handle = newHandle("r");
        reads.set(handle, { reader: stream.getReader(), ...(io.owner ? { owner: io.owner } : {}) });
        return { handle, bytes };
      }
      case "modelFile.read": {
        const reader = reads.get(request.handle)?.reader;
        if (!reader) return null;
        const next = await reader.read();
        if (next.done) {
          reads.delete(request.handle);
          return null;
        }
        return next.value;
      }
      case "modelFile.remove":
        await store.remove(request.ref);
        onChange();
        return true;
      case "modelFile.download": {
        const { handle } = request;
        const controller = new AbortController();
        downloads.set(handle, controller);
        void store
          .download(request.ref, (fraction) => io.post({ type: "modelFile.progress", handle, fraction }), controller.signal)
          .then(
            () => io.post({ type: "modelFile.downloaded", handle, ok: true }),
            (e: unknown) => io.post({ type: "modelFile.downloaded", handle, ok: false, error: errorText(e) }),
          )
          .finally(() => {
            downloads.delete(handle);
            onChange();
          });
        return true;
      }
      case "modelFile.support":
        return support();
      case "modelFile.close":
        close(request.handle);
        return undefined;
      case "modelFile.cancel":
        downloads.get(request.handle)?.abort();
        return undefined;
    }
  }

  return {
    handle(message, io) {
      if (!isModelFileRequest(message)) return false;
      const id = (message as { id?: string }).id;
      answer(message, io).then(
        (result) => {
          if (id) io.respond(id, true, result);
        },
        (e: unknown) => {
          if (id) io.respond(id, false, undefined, errorText(e));
        },
      );
      return true;
    },
    release(owner) {
      for (const [handle, entry] of [...reads]) if (entry.owner === owner) close(handle);
    },
    dispose() {
      for (const handle of [...reads.keys()]) close(handle);
      for (const controller of downloads.values()) controller.abort();
      downloads.clear();
    },
  };
}

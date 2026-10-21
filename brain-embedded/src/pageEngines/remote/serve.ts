/**
 * The ENGINE side of a remote page engine: answer a caller's probe and chat requests
 * (`protocol.ts`) from engines running here — the editor's chat webview, the editor
 * host's `bfi` worker, a page's `bfi` Web Worker. Pure over an injected transport, so
 * the round trip is testable without any of them.
 *
 * An engine refusal keeps its HTTP status across the boundary, so the caller's shim
 * answers exactly what it would have answered in place; an abort from the caller aborts
 * the engine here; chunks stream back one frame each. While a chat is running it says
 * so every {@link PAGE_ENGINE_HEARTBEAT_MS} (`pageEngine.alive`) — a long load or a turn
 * queued behind another sends no chunk for a while, and the caller's inactivity timeout
 * must tell that apart from an engine that went silent.
 */
import { PageEngineError, type PageEngine } from '../types';
import { PAGE_ENGINE_HEARTBEAT_MS, type PageEngineReply, type PageEngineRequest } from './protocol';

type ReplyPayload<T extends PageEngineReply['type']> = Omit<Extract<PageEngineReply, { type: T }>, 'type'>;

export interface PageEngineServerIo {
  /** Post a reply to the caller. */
  reply<T extends PageEngineReply['type']>(type: T, payload: ReplyPayload<T>): void;
  /** Subscribe to the caller's requests; returns the unsubscribe. */
  listen(onRequest: (request: PageEngineRequest) => void): () => void;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Serve `engines()` over `io`. The engines are read lazily, on the first request — a
 *  surface that never routes a turn to a page model never builds them. */
export function servePageEngines(engines: () => readonly PageEngine[], io: PageEngineServerIo): () => void {
  const running = new Map<string, AbortController>();
  const engineFor = (runtime: string) => engines().find((engine) => engine.runtime === runtime);

  async function chat(request: Extract<PageEngineRequest, { type: 'pageEngine.chat' }>): Promise<void> {
    const { id, runtime } = request;
    const engine = engineFor(runtime);
    if (!engine) {
      io.reply('pageEngine.error', { id, status: 503, code: `${runtime}_unavailable`, message: `${runtime} is not available here` });
      return;
    }
    const controller = new AbortController();
    running.set(id, controller);
    const heartbeat = setInterval(() => io.reply('pageEngine.alive', { id }), PAGE_ENGINE_HEARTBEAT_MS);
    try {
      const chunks = await engine.chatCompletions(request.body, controller.signal);
      for await (const chunk of chunks) {
        if (controller.signal.aborted) break;
        io.reply('pageEngine.chunk', { id, chunk });
      }
      if (!controller.signal.aborted) io.reply('pageEngine.end', { id });
    } catch (e) {
      // The caller asked for the stop; it already settled its side.
      if (controller.signal.aborted) return;
      const status = e instanceof PageEngineError ? e.status : 500;
      const code = e instanceof PageEngineError ? e.code : `${runtime}_engine_failed`;
      io.reply('pageEngine.error', { id, status, code, message: message(e) });
    } finally {
      clearInterval(heartbeat);
      running.delete(id);
    }
  }

  return io.listen((request) => {
    switch (request.type) {
      case 'pageEngine.probe': {
        const engine = engineFor(request.runtime);
        const asked = engine ? engine.probe(request.fresh ? { fresh: true } : undefined) : Promise.resolve(null);
        void asked
          .catch(() => null)
          .then((probe) => io.reply('pageEngine.probed', { id: request.id, probe }));
        return;
      }
      case 'pageEngine.chat':
        void chat(request);
        return;
      case 'pageEngine.abort':
        running.get(request.id)?.abort();
        return;
    }
  });
}

/**
 * The webview half of the page-engine bridge: it answers the extension host's probe and
 * chat requests from the engines this webview runs on WebGPU (see
 * `src/pageEngineBridgeProtocol.ts`). Pure over an injected transport so the round trip
 * is testable without a webview.
 *
 * An engine refusal keeps its HTTP status across the bridge, so the host's shim answers
 * exactly what it would have answered in the page; a Stop on the host aborts the engine
 * here; chunks stream back one frame each.
 */
import { PageEngineError, type PageEngine } from '@seanhogg/builderforce-brain-embedded';
import type { PageEngineReply, PageEngineRequest } from '../../src/pageEngineBridgeProtocol';

type ReplyPayload<T extends PageEngineReply['type']> = Omit<Extract<PageEngineReply, { type: T }>, 'type'>;

export interface PageEngineHostIo {
  /** Post a reply to the host. */
  reply<T extends PageEngineReply['type']>(type: T, payload: ReplyPayload<T>): void;
  /** Subscribe to the host's requests; returns the unsubscribe. */
  listen(onRequest: (request: PageEngineRequest) => void): () => void;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Serve `engines()` to the host over `io`. The engines are read lazily, on the first
 *  request — a panel that never routes a turn to a page model never builds them. */
export function servePageEngines(engines: () => readonly PageEngine[], io: PageEngineHostIo): () => void {
  const running = new Map<string, AbortController>();
  const engineFor = (runtime: string) => engines().find((engine) => engine.runtime === runtime);

  async function chat(request: Extract<PageEngineRequest, { type: 'pageEngine.chat' }>): Promise<void> {
    const { id, runtime } = request;
    const engine = engineFor(runtime);
    if (!engine) {
      io.reply('pageEngine.error', { id, status: 503, code: `${runtime}_unavailable`, message: `${runtime} is not available in this panel` });
      return;
    }
    const controller = new AbortController();
    running.set(id, controller);
    try {
      const chunks = await engine.chatCompletions(request.body, controller.signal);
      for await (const chunk of chunks) {
        if (controller.signal.aborted) break;
        io.reply('pageEngine.chunk', { id, chunk });
      }
      if (!controller.signal.aborted) io.reply('pageEngine.end', { id });
    } catch (e) {
      // The host asked for the stop; it already settled its side.
      if (controller.signal.aborted) return;
      const status = e instanceof PageEngineError ? e.status : 500;
      const code = e instanceof PageEngineError ? e.code : `${runtime}_engine_failed`;
      io.reply('pageEngine.error', { id, status, code, message: message(e) });
    } finally {
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

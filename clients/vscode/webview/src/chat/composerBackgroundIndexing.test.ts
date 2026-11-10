/**
 * PRD 41 §11 ("background indexing slows typing"): the background indexer must never re-render the chat composer.
 *
 * Everything the indexer sends a webview is a `knowledge.event` frame (`level`, and the live `graph` its changed facts
 * trigger), posted to the Visualization panel's Knowledge view. The composer re-renders only when the chat surface above
 * it does (`VsCodeComposer` is `memo`, with no subscription of its own), and the surface re-renders only on a chat-state
 * notification from the bridge. This webview has no DOM renderer (vitest `environment: 'node'`), so the render count is
 * measured at that one cause: the indexer's frames, delivered to the chat webview's real bridge, must produce ZERO
 * chat-state notifications — while an ordinary host frame does produce one (the harness is live).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KNOWLEDGE_EVENT, type KnowledgeEvent } from '../../../src/knowledge/knowledgeProtocol';

type Listener = (e: { data: unknown }) => void;
let listeners: Listener[];
const fromHost = (frame: Record<string, unknown>): void => {
  for (const listener of listeners) listener({ data: frame });
};

beforeEach(() => {
  listeners = [];
  vi.resetModules();
  const stub = {
    addEventListener: (type: string, cb: Listener) => { if (type === 'message') listeners.push(cb); },
    removeEventListener: () => {},
  };
  (globalThis as Record<string, unknown>).window = stub;
  (globalThis as Record<string, unknown>).addEventListener = stub.addEventListener;
  (globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {}, getState: () => undefined, setState: () => {} });
});

/** Every frame a busy background indexer produces for a webview: level changes for each level, and live graph refreshes. */
function indexerFrames(): Array<{ type: string; event: KnowledgeEvent }> {
  const frames: Array<{ type: string; event: KnowledgeEvent }> = [];
  for (let i = 0; i < 200; i++) {
    const level = (i % 4) as 0 | 1 | 2 | 3;
    frames.push({ type: KNOWLEDGE_EVENT, event: { stream: 'live-1', type: 'level', status: { rootId: 'r', ready: level, working: level, pending: i, files: 16_000, ...(i % 2 ? { paused: 'typing' as const } : {}) } } });
  }
  frames.push({ type: KNOWLEDGE_EVENT, event: { stream: 'live-1', type: 'graph', graph: { scope: { rootId: 'r' }, nodes: [], edges: [], findings: [] } as never, changed: ['src/a.ts'] } });
  return frames;
}

describe('the chat composer under background indexing (PRD 41 §11)', () => {
  it('re-renders zero times: no indexer frame reaches any chat-state subscription', async () => {
    const state = await import('../bridgeState');
    const transport = await import('../bridgeTransport');
    let renders = 0;
    const bump = (): void => { renders += 1; };
    const unsubs = [
      state.onInit(bump), state.onIntent(bump), state.onRefresh(bump), state.onEditorContext(bump), state.onPendingChanges(bump), state.onTokenChange(bump),
      // The run relay the chat surface subscribes to.
      ...['run.sync', 'run.settled', 'run.failed', 'run.tool', 'run.tools', 'run.modelFallback'].map((t) => transport.onHostMessage(t, bump)),
    ];
    for (const frame of indexerFrames()) fromHost(frame);
    expect(renders).toBe(0);

    fromHost({ type: 'refresh' }); // the harness is live: a chat frame does notify
    expect(renders).toBe(1);
    for (const u of unsubs) u();
  });

  it('the composer subscribes to nothing itself and is memoized, and no chat module listens for knowledge frames', () => {
    const dir = __dirname;
    const composer = fs.readFileSync(path.join(dir, 'VsCodeComposer.tsx'), 'utf8');
    expect(composer).toMatch(/export const VsCodeComposer = memo\(/);
    expect(composer).not.toMatch(/\buse(State|Effect|LayoutEffect|SyncExternalStore|Reducer|Context)\b|onHostMessage/);
    const chatSources = fs.readdirSync(dir, { recursive: true })
      .map(String)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
    for (const file of chatSources) {
      const text = fs.readFileSync(path.join(dir, file), 'utf8');
      expect(text, file).not.toMatch(/knowledge\.event|KNOWLEDGE_EVENT|indexLevels/);
    }
  });
});

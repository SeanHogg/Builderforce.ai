/**
 * Rovr's RUN HOST — the Chrome twin of the VS Code extension's `brainRunHost.ts`: it
 * turns "the person asked for something" into ONE shared Brain run (`startRun` from
 * brain-embedded — the same loop, run store, model hand-off and step persistence as the
 * web app and the editor) with the host's own stream, tools, persistence and gate.
 *
 * WHERE IT RUNS: the side panel document, not the service worker. An MV3 worker is torn
 * down after ~30 s without an event and capped at minutes of work, while a run streams
 * for as long as the model talks and pauses for as long as the person takes to answer a
 * confirmation — so the long-lived document the person is looking at owns the run, and
 * the worker owns only what must happen with the panel closed (syncing the backlog). A
 * panel closed mid-run loses only the run's remaining turns: every turn and step already
 * taken is in the device record and the durable outboxes.
 *
 * This module owns no `chrome` import — every browser-bound piece arrives as a port
 * (`rovrRunHostPorts.ts`), so the wiring is tested with fakes.
 */
import {
  clearRunError,
  getRunSnapshot,
  isRunning,
  resolveRunConfirm,
  startRun,
  stopRun,
  transcriptSeedFrom,
  type BrainMessage,
  type BrainRunPersistence,
  type BrainStreamFn,
  type BrainToolSpec,
} from '@seanhogg/builderforce-brain-embedded';
import { ROVR_DEFAULT_CHAT_MODE, type RovrRunOptions } from './runOptions';

/** One run's tool catalog: the schemas the model sees and the dispatcher behind them. */
export interface RunCatalog {
  specs: BrainToolSpec[];
  run(name: string, args: unknown): Promise<unknown>;
  /** The gate: true pauses the loop on the person's confirmation. */
  needsConfirm(req: { name: string; args: unknown }): boolean;
}

export interface RovrRunHostPorts {
  /** Local-first streamer (`inference/route.ts`). */
  stream: BrainStreamFn;
  /** Local-first persistence (`persistence/localFirstPersistence.ts`). */
  persistence: BrainRunPersistence;
  /** The chat's history, for the transcript seed. */
  history(chatId: number): Promise<BrainMessage[]>;
  /** Built per run: the browser tools act for THIS chat (ledger, tasks). */
  catalog(chatId: number): Promise<RunCatalog>;
  /** Rovr's system prompt for this run (playbooks, working tab, allowed sites). */
  systemPrompt(): Promise<string>;
  /** The chat's `/` Work panel choices for this run (`runOptions.ts`) — mode, effort,
   *  thinking, memory. Absent: a Chat-mode run at the default effort, with no memory. */
  runOptions?(chatId: number): Promise<RovrRunOptions>;
  /** The person declined a paused call — recorded on the action ledger. */
  onDeclined?(chatId: number, call: { name: string; args: unknown }): void;
}

export interface RovrRunHost {
  /** Persist the person's turn and run the loop on it. Resolves when the run settles. */
  send(chatId: number, text: string): Promise<void>;
  stop(chatId: number): void;
  confirm(chatId: number, ok: boolean): void;
  clearError(chatId: number): void;
}

export function createRovrRunHost(ports: RovrRunHostPorts): RovrRunHost {
  /** Chats with a turn being set up — claimed before the async setup (a double submit). */
  const starting = new Set<number>();

  return {
    async send(chatId, text) {
      const turn = text.trim();
      if (!turn || starting.has(chatId) || isRunning(chatId)) return;
      starting.add(chatId);
      try {
        const prior = await ports.history(chatId);
        await ports.persistence.sendMessages(chatId, [{ role: 'user', content: turn }]);
        const [catalog, systemPrompt, options] = await Promise.all([
          ports.catalog(chatId),
          ports.systemPrompt(),
          ports.runOptions ? ports.runOptions(chatId) : Promise.resolve(null),
        ]);
        await startRun(chatId, {
          resolvedSystemPrompt: options?.directives ? `${systemPrompt}\n\n${options.directives}` : systemPrompt,
          tools: catalog.specs,
          runTool: catalog.run,
          needsConfirm: catalog.needsConfirm,
          stream: ports.stream,
          persistence: ports.persistence,
          seed: transcriptSeedFrom(prior),
          userTurn: turn,
          // A personal assistant answers and acts on the person's explicit request; it
          // opens and staffs board work only when the chat is switched to Work
          // (`chatMode.ts`).
          chatMode: options?.chatMode ?? ROVR_DEFAULT_CHAT_MODE,
          ...(options ? { maxTokens: options.maxTokens } : {}),
          ...(options?.reasoning ? { reasoning: options.reasoning } : {}),
          ...(options?.evermind ? { evermind: options.evermind } : {}),
          projectId: null,
        });
      } finally {
        starting.delete(chatId);
      }
    },
    stop: (chatId) => stopRun(chatId),
    confirm(chatId, ok) {
      const pending = getRunSnapshot(chatId).pendingConfirm;
      if (!ok && pending) ports.onDeclined?.(chatId, pending);
      resolveRunConfirm(chatId, ok);
    },
    clearError: (chatId) => clearRunError(chatId),
  };
}

/**
 * Rovr's RUN PORTS — what Rovr adds to THE shared conversation (`useBrainConversation`,
 * the same hook the web Brain and the VS Code webview mount): the parts of a run only
 * Rovr can know, resolved at each run's start through the hook's `prepareRun` seam, and
 * the safety gate's decline record. The turn itself — persisting it, the queue, the run,
 * the stream, Stop, the error and its remedies, "Switch to Hybrid" re-sending — is the
 * hook's, exactly as on every other surface.
 *
 * WHERE IT RUNS: the side panel document, not the service worker. An MV3 worker is torn
 * down after ~30 s without an event and capped at minutes of work, while a run streams
 * for as long as the model talks and pauses for as long as the person takes to answer a
 * confirmation — so the long-lived document the person is looking at owns the run (the
 * hook lives in it), and the worker owns only what must happen with the panel closed
 * (syncing the backlog).
 *
 * This module owns no `chrome` import — every browser-bound piece arrives as a port, so
 * the wiring is tested with fakes.
 */
import {
  getRunSnapshot,
  resolveRunConfirm,
  type BrainRunRequest,
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
  /** The conversation hook's `prepareRun`: Rovr's catalog, prompt and options for `chatId`. */
  prepareRun(chatId: number): Promise<Partial<BrainRunRequest>>;
  /** Answer the safety gate's pause; a decline is recorded on the ledger first. */
  confirm(chatId: number, ok: boolean): void;
}

export function createRovrRunHost(ports: RovrRunHostPorts): RovrRunHost {
  return {
    async prepareRun(chatId) {
      const [catalog, systemPrompt, options] = await Promise.all([
        ports.catalog(chatId),
        ports.systemPrompt(),
        ports.runOptions ? ports.runOptions(chatId) : Promise.resolve(null),
      ]);
      return {
        resolvedSystemPrompt: options?.directives ? `${systemPrompt}\n\n${options.directives}` : systemPrompt,
        tools: catalog.specs,
        runTool: catalog.run,
        needsConfirm: catalog.needsConfirm,
        // A personal assistant answers and acts on the person's explicit request; it
        // opens and staffs board work only when the chat is switched to Work
        // (`chatMode.ts`).
        chatMode: options?.chatMode ?? ROVR_DEFAULT_CHAT_MODE,
        ...(options ? { maxTokens: options.maxTokens } : {}),
        ...(options?.reasoning ? { reasoning: options.reasoning } : {}),
        ...(options?.evermind ? { evermind: options.evermind } : {}),
        projectId: null,
      };
    },
    confirm(chatId, ok) {
      const pending = getRunSnapshot(chatId).pendingConfirm;
      if (!ok && pending) ports.onDeclined?.(chatId, pending);
      resolveRunConfirm(chatId, ok);
    },
  };
}

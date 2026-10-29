'use client';

/**
 * Module-level Brain run engine — the agent tool-loop, hoisted OUT of React so a
 * run survives the unmount of the component that started it.
 *
 * Why this exists: the Brain UI (BrainPanel) is mounted per-route — the full
 * page `/brainstorm`, the IDE-embedded panel, the floating drawer. When the
 * Brain navigates the user mid-run (a `navigate_to` tool call), the route-scoped
 * panel unmounts. Previously the loop's state (rich transcript, trace, streaming
 * delta, the human-in-the-loop confirm resolver) lived in that component's refs,
 * so the run was orphaned: its React state updates went nowhere, the freshly
 * mounted instance lost all grounding, and — worst — it re-answered the trailing
 * user message, spawning a SECOND concurrent loop (duplicate writes).
 *
 * The fix: one run per chat lives here, keyed by chatId, single-flight. Any
 * mounted Brain instance subscribes to its chat's cell and renders the live run;
 * a second instance that tries to start the same chat is a no-op. Every turn
 * that produces visible text — both intermediate tool-call narration and the
 * final answer — is persisted as its own message; mounted instances pick each
 * one up via `messagesEpoch`, so a turn's narration is a durable block instead
 * of transient streaming text the next turn overwrites. The confirm gate also
 * lives here, so a navigation that swaps which panel is mounted can still
 * resolve a pending confirmation.
 *
 * This module owns NO React — `useBrainConversation` is the thin binding. It is the
 * store's ONE public face; the store itself is `runStore/`:
 *
 *   - `runTypes.ts`        — the request a host hands a run and the snapshot it observes;
 *   - `runCell.ts` / `runCells.ts` — a chat's cell, the registry, repaint and trace;
 *   - `runControl.ts`      — subscribe, read, Stop, confirm, clear, mirror a remote run;
 *   - `startRun.ts`        — the single-flight start and what a run does as it unwinds;
 *   - `engineRun.ts`       — the same cell hosting a non-chat loop (a canvas turn);
 *   - `beginRun.ts`        — the per-run reset both starts share;
 *   - `runLoop.ts`         — THE loop, composed from its hooks and ports;
 *   - `runBackstops.ts`    — the ticket guarantees; `turnPersistence.ts` — durable turns.
 */

export {
  resetBrainRunStore,
  getRunStoreSize,
  subscribeRunStore,
  getGlobalRunState,
  subscribeRun,
  runAbortSignal,
  appendRunMessage,
  getRunSnapshot,
  isRunning,
  isLive,
  getRunTrace,
  stopRun,
  stopBeforeStart,
  clearRunError,
  resolveRunConfirm,
  applyRemoteRun,
} from './runStore/runControl';
export { startRun } from './runStore/startRun';
export { startEngineRun } from './runStore/engineRun';
export type { BrainRunEngine, RunEngineControl } from './runStore/engineRun';
export type { BrainStreamFn, BrainRunPersistence, BrainRunRequest, BrainRunSnapshot, GlobalRunState, RunKey, RunTurn } from './runStore/runTypes';

/**
 * Framework-free entry point for the Brain agent loop — a documented alias of
 * {@link startRun}. A non-React host (e.g. the native VS Code chat participant)
 * drives a run by calling `runBrainLoop(chatId, req)` and observing it with
 * {@link subscribeRun} + {@link getRunSnapshot} / {@link getRunTrace}, without
 * pulling in the React hook. Same single-flight semantics as `startRun`.
 */
export { startRun as runBrainLoop } from './runStore/startRun';

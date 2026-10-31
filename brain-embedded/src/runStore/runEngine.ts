/**
 * Which engine drives a run (PRD 35 WS4): the Brain's own loop (`runLoop.ts`) or THE one agent
 * (`run/runPrepared.ts`). `prepareRunLoop` runs for both, so a null preparation still ends the
 * run before any model call; only the loop that follows differs.
 *
 * The switch selects the engine and nothing else. It is read once, at the host's request site
 * (`engine` on the request), and goes away when the ship gate flips the default.
 */

import { runPrepared } from '../run/runPrepared';
import type { RunCell } from './runCell';
import { prepareRunLoop } from './runPreamble';
import { runLoop } from './runLoop';
import { noteRunId } from './runEndOutcome';
import type { BrainRunRequest, RunEngineId } from './runTypes';

/** The device's engine, read the way `deviceLevers.ts` reads its env: safely, on any host. */
function deviceEngine(): RunEngineId | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const raw = env?.BRAIN_RUN_ENGINE;
  return raw === 'agent' || raw === 'loop' ? raw : undefined;
}

/** The engine for a request: its own choice, else the device's, else the Brain's loop. */
export function runEngineOf(req: Pick<BrainRunRequest, 'engine'>): RunEngineId {
  return req.engine ?? deviceEngine() ?? 'loop';
}

/** Prepare the run, then hand it to the engine the request names. */
export async function driveRun(chatId: number, c: RunCell, req: BrainRunRequest, runKey: number): Promise<void> {
  const prepared = await prepareRunLoop(chatId, c, req, runKey);
  // Memory answered: the run is over before a model was asked.
  if (!prepared) return;
  // The id this run's calls carry - what its end is reported under (`runEndOutcome.ts`).
  noteRunId(c, prepared.metadata.guestTurnId);
  if (runEngineOf(req) === 'agent') return runPrepared(prepared);
  return runLoop(prepared);
}

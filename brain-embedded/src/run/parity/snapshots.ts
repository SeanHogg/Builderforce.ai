/**
 * The stored expected records (PRD 35 WS4, D4). Each file is the record the Brain's old loop (`runLoop.ts`, deleted at the ship gate)
 * left for one scenario; the agent is held to it by `snapshot.test.ts`. They are READ-ONLY: nothing can write one, because the only
 * thing left to write one from is the agent, and a snapshot made from the agent proves nothing about the agent. A behaviour change
 * that is genuinely intended is a planning decision, not a regeneration.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunRecord } from './types';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'snapshots');

const fileOf = (id: string): string => join(DIR, `${id}.json`);

/** True when this process was asked to write snapshots (`PARITY_SNAPSHOT=write`): refused, see `snapshot.test.ts`. */
export const writingSnapshots = (): boolean => process.env.PARITY_SNAPSHOT === 'write';

/** The stored record of scenario `id`, or undefined when none was generated. */
export function readSnapshot(id: string): RunRecord | undefined {
  return existsSync(fileOf(id)) ? (JSON.parse(readFileSync(fileOf(id), 'utf8')) as RunRecord) : undefined;
}

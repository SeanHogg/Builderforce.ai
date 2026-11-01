/**
 * The stored expected records (PRD 35 WS4, D4). After `runLoop.ts` is deleted the differential suite has nothing to
 * compare against; these files are what it compared against, kept. A snapshot is generated ONLY from the loop engine
 * (`writeSnapshot` refuses any other), today, and is thereafter the regression oracle for the agent. Regenerating one is
 * an act of choice: `PARITY_SNAPSHOT=write` with the loop engine still present, and the diff reviewed as a behaviour
 * change - never to make a failing run pass.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunEngineId } from '../../runStore/runTypes';
import type { RunRecord } from './types';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'snapshots');

const fileOf = (id: string): string => join(DIR, `${id}.json`);

/** True when this process was asked to write snapshots. */
export const writingSnapshots = (): boolean => process.env.PARITY_SNAPSHOT === 'write';

/** Store `record` as scenario `id`'s expected record. Only a loop-engine record may become one. */
export function writeSnapshot(id: string, engine: RunEngineId, record: RunRecord): void {
  if (engine !== 'loop') throw new Error(`a snapshot is generated from the loop engine only (got ${engine})`);
  if (record.scenarioError) throw new Error(`${id}: the loop did not complete the scenario: ${record.scenarioError}`);
  mkdirSync(DIR, { recursive: true });
  writeFileSync(fileOf(id), `${JSON.stringify(record, null, 1)}\n`, 'utf8');
}

/** The stored record of scenario `id`, or undefined when none was generated. */
export function readSnapshot(id: string): RunRecord | undefined {
  return existsSync(fileOf(id)) ? (JSON.parse(readFileSync(fileOf(id), 'utf8')) as RunRecord) : undefined;
}

/**
 * The stored expected records (PRD 35 WS4, D4; regeneration protocol added for PRD 45). Each file is the record left for one
 * scenario; the agent is held to it by `snapshot.test.ts`. They are READ-ONLY by default: a snapshot made casually from the
 * agent proves nothing about the agent, so writing one needs a deliberate, reviewable, one-time operator action — BOTH
 * `PARITY_SNAPSHOT=write` in the environment AND a `REGENERATE.md` in this directory whose contents state the regeneration
 * is authorized (date + reason). The operator DELETES `REGENERATE.md` when done, so the env var alone can never silently
 * re-arm regeneration. PRD 45 (deterministic run gates) is the approved reason the records were regenerated once.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunRecord } from './types';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'snapshots');
const REGENERATE_MARK = join(dirname(fileURLToPath(import.meta.url)), 'REGENERATE.md');

const fileOf = (id: string): string => join(DIR, `${id}.json`);

/** True when this process was asked to write snapshots (`PARITY_SNAPSHOT=write`): refused, see `snapshot.test.ts`. */
export const writingSnapshots = (): boolean => process.env.PARITY_SNAPSHOT === 'write' && regenerationAuthorized();

/** The deliberate marker: a REGENERATE.md stating the regeneration is authorized (date + reason). */
function regenerationAuthorized(): boolean {
  if (!existsSync(REGENERATE_MARK)) return false;
  try {
    const text = readFileSync(REGENERATE_MARK, 'utf8');
    return /authorized/i.test(text) && /\d{4}-\d{2}-\d{2}/.test(text);
  } catch {
    return false;
  }
}

/** The stored record of scenario `id`, or undefined when none was generated. */
export function readSnapshot(id: string): RunRecord | undefined {
  return existsSync(fileOf(id)) ? (JSON.parse(readFileSync(fileOf(id), 'utf8')) as RunRecord) : undefined;
}

/**
 * Write the record for scenario `id` as its new golden record. Deliberately gated: requires BOTH `PARITY_SNAPSHOT=write`
 * AND an authorized `REGENERATE.md` (`writingSnapshots()`), and refuses otherwise — regeneration is an operator action,
 * never something an env var left open in CI can do on its own.
 */
export function writeSnapshot(id: string, record: RunRecord): void {
  if (!writingSnapshots()) {
    throw new Error('refusing to write a snapshot: requires PARITY_SNAPSHOT=write AND an authorized REGENERATE.md');
  }
  writeFileSync(fileOf(id), `${JSON.stringify(record, null, 1)}\n`, 'utf8');
}

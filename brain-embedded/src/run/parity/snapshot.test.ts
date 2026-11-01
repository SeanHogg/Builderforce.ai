/**
 * The snapshot suite (PRD 35 WS4, D4): every engine still present runs every scenario and must equal the record the loop
 * left when the snapshot was generated. With `loop` in the list it also proves the snapshots are current and the harness is
 * deterministic; once the loop is gone the agent is held to the loop's last word.
 *
 * `PARITY_SNAPSHOT=write` generates the snapshots from the loop engine (see `snapshots.ts`).
 */
import { describe, expect, it } from 'vitest';
import { diffRecords } from './diff';
import { ENGINES } from './engines';
import { runScenario } from './harness';
import { scenarios } from './scenarios';
import { readSnapshot, writeSnapshot, writingSnapshots } from './snapshots';

describe('every engine reproduces the stored record of the loop', () => {
  for (const s of scenarios) {
    for (const engine of ENGINES) {
      it(`${s.id} on ${engine}`, async () => {
        const record = await runScenario(s, engine);
        if (writingSnapshots()) {
          if (engine === 'loop') writeSnapshot(s.id, engine, record);
          return;
        }
        const stored = readSnapshot(s.id);
        expect(stored, `no snapshot for ${s.id}: generate with PARITY_SNAPSHOT=write on the loop engine`).toBeDefined();
        expect(diffRecords(stored, record, ['snapshot', engine])).toEqual([]);
      }, 60_000);
    }
  }
});

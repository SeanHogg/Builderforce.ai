import { describe, expect, it } from 'vitest';
import {
  parseProjectEvermindModel,
  recordProjectEvermindCodingEval,
  resolveEvermindCodingRoute,
} from './evermindCodingEvalStore';
import { resolveProjectEvermindModelPin, resolveProjectInferenceModel } from './projectEvermind';
import type { EvermindCodingEval } from './evermindCodingGate';
import type { Env } from '../../env';

/**
 * The coding gate's I/O: the eval write path, and the routers' reads. The point of the
 * suite is the operator's rule — Evermind serves a CODING turn only with a recorded
 * coding eval ≥ 90% of the frontier baseline for THAT head version — and that a closed
 * gate always degrades to "no Evermind pin" (the caller's normal model), never an error.
 */

// No AUTH_CACHE_KV → the head cache falls through to the loader on every read.
const env = {} as Env;

/** A one-row `project_evermind` table: selects read it; `update().set()` mutates it
 *  when the `returning` queue says the guarded UPDATE matched. */
function tableDb(row: Record<string, unknown> | null, updateMatches: boolean[] = []) {
  let u = 0;
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (row ? [row] : []) }) }) }),
    update: () => {
      let values: Record<string, unknown> = {};
      const chain = {
        set: (v: Record<string, unknown>) => { values = v; return chain; },
        where: () => ({
          returning: async () => {
            const matched = updateMatches[u++] ?? false;
            if (matched && row) Object.assign(row, values);
            return matched ? [{ id: 'row' }] : [];
          },
        }),
      };
      return chain;
    },
  } as never;
  return db;
}

const seeded = (over: Record<string, unknown> = {}) => ({
  name: 'PM', version: 12, mode: 'connected', contributions: 3, inferenceEnabled: true, ...over,
});
const qualifyingEvalCols = (version = 12) => ({
  codingEvalVersion: version, codingEvalScore: 0.76, codingEvalBaselineScore: 0.8,
  codingEvalBaselineModel: 'claude-opus-5', codingEvalDataset: 'coding-v1', codingEvalAt: new Date('2026-09-12T00:00:00Z'),
});
const EVAL: EvermindCodingEval = { version: 12, score: 0.76, baselineScore: 0.8, baselineModel: 'claude-opus-5', dataset: 'coding-v1', evaluatedAt: '2026-09-12T00:00:00.000Z' };

describe('recordProjectEvermindCodingEval', () => {
  it('stores the eval against the head it scored and reports the gate opening', async () => {
    const row = seeded();
    const out = await recordProjectEvermindCodingEval(env, tableDb(row, [true]), 7, 42, EVAL);
    expect(out).toMatchObject({ ok: true, gate: { qualified: true, reason: 'qualified', evaluatedVersion: 12 } });
    expect(row).toMatchObject({ codingEvalVersion: 12, codingEvalScore: 0.76, codingEvalBaselineScore: 0.8, codingEvalDataset: 'coding-v1' });
  });

  it('refuses an eval of a version that is no longer the head (409 + headVersion)', async () => {
    const row = seeded({ version: 13 });
    const out = await recordProjectEvermindCodingEval(env, tableDb(row, [false]), 7, 42, EVAL);
    expect(out).toMatchObject({ ok: false, status: 409, headVersion: 13 });
    expect(row).not.toHaveProperty('codingEvalVersion');
  });
});

describe('parseProjectEvermindModel', () => {
  it('inverts evermind/<projectEvermindRef>', () => {
    expect(parseProjectEvermindModel('evermind/evermind/project/7/42/v3')).toEqual({ tenantId: 7, projectId: 42, version: 3 });
  });
  it('rejects anything that is not a project head ref', () => {
    expect(parseProjectEvermindModel('evermind/evermind-models/7/my-model')).toBeNull();
    expect(parseProjectEvermindModel('evermind/evermind/project/7/42')).toBeNull();
    expect(parseProjectEvermindModel('evermind/evermind/project/7/42/v0')).toBeNull();
  });
});

describe('resolveEvermindCodingRoute', () => {
  const PIN = 'evermind/evermind/project/7/42/v12';

  it('has nothing to gate for a non-Evermind model', async () => {
    expect(await resolveEvermindCodingRoute(env, tableDb(seeded()), 7, 'claude-opus-5')).toBeUndefined();
    expect(await resolveEvermindCodingRoute(env, tableDb(seeded()), 7, undefined)).toBeUndefined();
  });

  it('stays closed for a head with no coding eval (today) — the reason travels with it', async () => {
    const route = await resolveEvermindCodingRoute(env, tableDb(seeded()), 7, PIN);
    expect(route).toMatchObject({ model: PIN, qualified: false, gate: { reason: 'no_eval' } });
  });

  it('opens for the CURRENT head when its eval clears the bar', async () => {
    expect(await resolveEvermindCodingRoute(env, tableDb(seeded(qualifyingEvalCols())), 7, PIN)).toMatchObject({ qualified: true });
  });

  it('stays closed for a pin naming an older version, even if the current head qualifies', async () => {
    const old = 'evermind/evermind/project/7/42/v11';
    expect(await resolveEvermindCodingRoute(env, tableDb(seeded(qualifyingEvalCols())), 7, old)).toMatchObject({ qualified: false });
  });

  it('never qualifies a published Studio model or another tenant’s head', async () => {
    expect(await resolveEvermindCodingRoute(env, tableDb(seeded(qualifyingEvalCols())), 7, 'evermind/evermind-models/7/x')).toEqual({ model: 'evermind/evermind-models/7/x', qualified: false });
    expect(await resolveEvermindCodingRoute(env, tableDb(seeded(qualifyingEvalCols())), 8, PIN)).toMatchObject({ qualified: false });
  });
});

describe('resolveProjectInferenceModel — purpose: coding', () => {
  it('keeps the non-coding behaviour unchanged (inference on + seeded → pin)', async () => {
    expect(await resolveProjectInferenceModel(env, tableDb(seeded()), 7, 42)).toBe('evermind/evermind/project/7/42/v12');
  });

  it('withholds the pin from a CODING turn while the gate is closed — the caller keeps its normal model', async () => {
    expect(await resolveProjectInferenceModel(env, tableDb(seeded()), 7, 42, { purpose: 'coding' })).toBeUndefined();
    expect(await resolveProjectInferenceModel(env, tableDb(seeded(qualifyingEvalCols(11))), 7, 42, { purpose: 'coding' })).toBeUndefined();
  });

  it('pins a CODING turn once the head qualifies', async () => {
    expect(await resolveProjectInferenceModel(env, tableDb(seeded(qualifyingEvalCols())), 7, 42, { purpose: 'coding' }))
      .toBe('evermind/evermind/project/7/42/v12');
  });

  it('never turns inference on by itself — a qualifying eval on a disabled head pins nothing', async () => {
    expect(await resolveProjectInferenceModel(env, tableDb(seeded({ ...qualifyingEvalCols(), inferenceEnabled: false })), 7, 42, { purpose: 'coding' }))
      .toBeUndefined();
  });

  it('gates the gateway `project_evermind:<id>` pin the IDE sends', async () => {
    expect(await resolveProjectEvermindModelPin(env, tableDb(seeded()), 7, 'project_evermind:42', { purpose: 'coding' }))
      .toEqual({ matched: true, model: undefined });
  });
});

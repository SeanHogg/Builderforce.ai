import { describe, expect, it } from 'vitest';
import { buildMlHeadDelta, mlHeadParams } from '@seanhogg/builderforce-memory-engine';
import { mergeMlHeadRound, mlHeadDoorFor, mlHeadView, parseMlHeadContribution, type MlHeadEvalRow } from './evermindMlHeads';

/**
 * The writer's half of federated ML heads. Load-bearing:
 *  - a registered head target finds its door; the model (no target) and unregistered
 *    targets do not;
 *  - the parse runs the engine's delta contract WITH the head's target, so a body aimed
 *    at another checkpoint is refused, and a contribution with nothing to score is too;
 *  - a round is the engine's eval-gated FedAvg: an improving round bumps the version and
 *    records its loss, a regressing one is refused in the delta door's 409 shape and the
 *    head stays put — and either way the round's rows join the eval pool.
 */

const TARGET = 'ml:run.local-success';
const door = mlHeadDoorFor(TARGET)!;
/** Nine engine-scaled features; every row says the local model FAILS (class 0). */
const failing: MlHeadEvalRow[] = Array.from({ length: 6 }, (_, i) => ({ x: [0.1 * i, 0.2, 0.05, 0, 0, 0, 0, 0.5, 0], y: 0 }));
/** Logistic params: 18 weights, then the biases of class 0 (fails) and class 1 (succeeds). */
const head = (fails: number, succeeds: number): number[] => [...Array<number>(18).fill(0), fails, succeeds];
const contribution = (trained: number[], baseVersion = 0) => {
  const base = door.initial();
  const payload = { ...buildMlHeadDelta(base, trained, 10), baseVersion };
  return { payload, holdout: failing };
};

describe('mlHeadDoorFor', () => {
  it('finds the run.local-success head, and nothing for the model or an unregistered head', () => {
    expect(door.target).toBe(TARGET);
    expect(door.initial()).toMatchObject({ task: 'run.local-success', version: 0 });
    expect(mlHeadDoorFor(undefined)).toBeUndefined();
    expect(mlHeadDoorFor('ml:experience.quality')).toBeUndefined();
  });
});

describe('parseMlHeadContribution', () => {
  const body = { ...buildMlHeadDelta(door.initial(), head(1, -1), 10), holdout: failing };

  it('admits a head delta at its own door, keeping only well-formed held-out rows', () => {
    const parsed = parseMlHeadContribution({ ...body, holdout: [...failing, { x: [1, 2], y: 0 }, { x: failing[0]!.x, y: 4 }] }, door);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.contribution.payload.target).toBe(TARGET);
    expect(parsed.contribution.holdout).toHaveLength(failing.length);
  });

  it('refuses a body aimed at another checkpoint (target mismatch) in the delta door shape', () => {
    const { target: _omit, ...modelDelta } = body;
    const parsed = parseMlHeadContribution(modelDelta, door);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.refusal.status).toBe(400);
    expect(parsed.refusal.body).toMatchObject({ ok: false });
    expect(String(parsed.refusal.body.error)).toContain('does not belong here');
  });

  it('refuses a contribution with no held-out rows — the gate could not score it', () => {
    const parsed = parseMlHeadContribution({ ...body, holdout: [] }, door);
    expect(parsed.ok).toBe(false);
  });
});

describe('mergeMlHeadRound', () => {
  it('accepts a round that lowers the held-out loss: version + 1, its loss recorded, rows pooled', () => {
    const round = mergeMlHeadRound(door, door.initial(), [contribution(head(1, -1))], []);
    expect(round.accepted).toBe(true);
    expect(round.refusal).toBeUndefined();
    expect(round.head.version).toBe(1);
    expect(round.head.evalLoss!).toBeLessThan(Math.LN2);
    expect(Array.from(mlHeadParams(round.head)).slice(-2)).toEqual([1, -1]);
    expect(round.pool).toHaveLength(failing.length);
    expect(mlHeadView(door, round.head)).toMatchObject({ target: TARGET, version: 1, params: head(1, -1) });
  });

  it('refuses a round that raises it, in the 409 regression shape, and keeps the head', () => {
    const base = door.initial();
    const round = mergeMlHeadRound(door, base, [contribution(head(-1, 1))], []);
    expect(round.accepted).toBe(false);
    expect(round.head).toBe(base);
    expect(round.refusal?.status).toBe(409);
    expect(round.refusal?.body).toMatchObject({ ok: false });
    expect(round.refusal?.body.newLoss as number).toBeGreaterThan(round.refusal?.body.baseLoss as number);
    // The rows still join the pool: the next round answers to them.
    expect(round.pool).toHaveLength(failing.length);
  });

  it('a stale contribution costs only itself; a round with nothing usable is refused', () => {
    const round = mergeMlHeadRound(door, door.initial(), [contribution(head(1, -1), 5)], []);
    expect(round.accepted).toBe(false);
    expect(round.rejected[0]!.reason).toContain('stale base version 5');
    expect(round.refusal?.status).toBe(400);
  });

  it('a never-merged head reads with no params', () => {
    expect(mlHeadView(door, door.initial())).toEqual({ target: TARGET, version: 0, params: null, evalLoss: null });
  });
});

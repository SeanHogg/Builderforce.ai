/**
 * Findings 11 & 12 — what happens AFTER a run finishes.
 *
 * The `verify` phase was DECLARED in the run policy (`verify_started`) and HANDLED by
 * its reducer, but no run loop ever EMITTED it — so the policy meant to gate runs on a
 * verify step never saw one. Separately nothing committed what a run learned, so runs
 * taught the system nothing.
 *
 * These tests pin the two behaviours at the container seam, because that is where a
 * run's work, its verification and its memory write all meet:
 *   - the `verify` op emits `verify_started` + the paired completion event, in order;
 *   - it commits memory AFTER the verdict, through the EXISTING memory API;
 *   - and a failing memory write never changes the verdict the run finishes with.
 */
import { describe, expect, it } from 'vitest';
import { applyVerifyPhase, describeVerifyOutcome } from './runEndMemory';
import { OP_HANDLERS } from './containerOps';
import { inRunVerifyOutcome, planInRunVerify } from './inRunVerify';
import { initialRunPolicy, reduceRunPolicy, type RunPolicyState } from '@builderforce/run-policy';

describe('verify phase transition (finding 11)', () => {
  it('moves the policy into the verify phase from the code phase', () => {
    const state: RunPolicyState = initialRunPolicy({ startPhase: 'code' });
    expect(state.phase).not.toBe('verify');
    expect(applyVerifyPhase(state).phase).toBe('verify');
  });

  it('uses the declared event name, not an invented one', () => {
    // The reducer only advances on this exact name — a typo here is the original bug.
    const started = applyVerifyPhase(initialRunPolicy({ startPhase: 'code' }));
    const viaReducer = reduceRunPolicy(initialRunPolicy({ startPhase: 'code' }), { type: 'verify_started' });
    expect(started).toEqual(viaReducer);
  });
});

describe('verify outcome note', () => {
  it('describes a green run honestly', () => {
    const outcome = inRunVerifyOutcome({
      surface: 'container',
      writtenPaths: ['a.ts'],
      packageScripts: { typecheck: 'tsc --noEmit' },
      results: [{ command: 'npm run typecheck', exitCode: 0 }],
    });
    expect(describeVerifyOutcome(outcome)).toContain('typecheck');
  });

  it('names a failing check, so the memory note carries the failure', () => {
    // `packageScripts` is what tells the planner a check is declared at all — without
    // it the honest answer is "skipped: no_scripts", not a failure.
    const outcome = inRunVerifyOutcome({
      surface: 'container',
      writtenPaths: ['a.ts'],
      packageScripts: { test: 'vitest run' },
      results: [{ command: 'npm run test', exitCode: 1 }],
    });
    const note = describeVerifyOutcome(outcome);
    expect(note).toMatch(/test/);
    expect(note).toMatch(/1 failed/);
  });

  it('has a note for every outcome shape, including the skipped one', () => {
    const surfaces = ['durable', 'container', 'on-prem'] as const;
    for (const surface of surfaces) {
      for (const writtenPaths of [[], ['a.ts']]) {
        const outcome = inRunVerifyOutcome({ surface, writtenPaths, results: null });
        expect(typeof outcome.mayFinish).toBe('boolean');
        expect(describeVerifyOutcome(outcome).length).toBeGreaterThan(0);
      }
    }
  });
});

describe('the verify plan the image asks for', () => {
  it('never invents a script the manifest does not declare', () => {
    const plan = planInRunVerify({ surface: 'container', packageScripts: { build: 'tsc' } });
    expect(plan.commands).toEqual([]);
  });

  it('reports honestly when there is no shell to run checks in', () => {
    const plan = planInRunVerify({ surface: 'durable', packageScripts: { test: 'vitest run' } });
    expect(plan.kind).toBe('skipped');
    expect(plan.reason).toBe('no_shell');
  });
});

describe('the container verify op: events, then memory (findings 11 & 12)', () => {
  /**
   * A DB stub that records what a run wrote onto its timeline. `recordCloudToolEvent`
   * inserts through Drizzle (`insert(table).values(row).returning(...)`) and stores the
   * event's detail as a JSON string in the row's `args` column — so the stub intercepts
   * that chain and parses `args` back out, which is how the real rows read.
   */
  function stubDb() {
    const events: Array<{ toolName: string; category: string; detail?: unknown }> = [];
    const values = (row: Record<string, unknown>) => ({
      returning: async () => {
        events.push({
          toolName: String(row.toolName ?? ''),
          category: String(row.category ?? ''),
          detail: typeof row.args === 'string' ? JSON.parse(row.args) : row.args,
        });
        return [{ id: events.length }];
      },
    });
    const db = {
      insert: () => ({ values }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
      prepare: () => ({ bind: () => ({ first: async () => null, run: async () => undefined, all: async () => ({ results: [] }) }) }),
    } as never;
    return { events, db };
  }

  it('emits verify_started and the paired completion, then commits memory', async () => {
    const { db, events } = stubDb();
    const result = await OP_HANDLERS.verify!({
      db,
      env: { KV: { get: async () => null, put: async () => undefined } } as never,
      executionId: 7,
      args: {
        writtenPaths: ['src/a.ts'],
        packageScripts: { typecheck: 'tsc --noEmit' },
        results: [{ command: 'npm run typecheck', exitCode: 0 }],
        summary: 'Added the parser to the canvas loader.',
      },
      tenantId: 1,
      projectId: 2,
      taskId: 3,
      cloudAgentRef: 'agent-x',
      surface: 'container',
    } as never);

    // The verdict is unchanged by any of the above — it is the run's own result.
    expect((result.body as { ok: boolean }).ok).toBe(true);

    // The run's timeline observed the DECLARED verify phase, then its completion.
    const names = events.map((e) => `${e.toolName}:${JSON.stringify(e.detail)}`);
    expect(names.some((n) => n.startsWith('run_policy:') && n.includes('verify_started'))).toBe(true);
    // The completion carries the verdict, in the declared order: start first.
    const startedAt = names.findIndex((n) => n.includes('verify_started'));
    const completedAt = names.findIndex((n) => n.startsWith('in_run_verify:'));
    expect(startedAt).toBeGreaterThanOrEqual(0);
    expect(completedAt).toBeGreaterThan(startedAt);

    // And the run actually wrote something down, through the existing memory API.
    expect(events.some((e) => e.toolName.includes('memory'))).toBe(true);
  });

  it('keeps the run result when the memory write fails', async () => {
    // Every statement through this DB throws — the memory write cannot land.
    const failing = { prepare: () => { throw new Error('memory backend down'); }, batch: async () => { throw new Error('memory backend down'); } } as never;

    const result = await OP_HANDLERS.verify!({
      db: failing,
      env: { KV: { get: async () => null, put: async () => undefined } } as never,
      executionId: 8,
      args: { writtenPaths: ['src/a.ts'], results: [{ command: 'npm run test', exitCode: 0 }], summary: 'did the work' },
      tenantId: 1, projectId: 2, taskId: 3, cloudAgentRef: 'agent-x', surface: 'container',
    } as never);

    // The run still finishes with its result — losing memory must not lose the run.
    expect((result.body as { ok: boolean }).ok).toBe(true);
  });

  it('answers a plan request with commands and no side effects', async () => {
    const { db, events } = stubDb();
    const result = await OP_HANDLERS.verify!({
      db,
      env: { KV: { get: async () => null, put: async () => undefined } } as never,
      executionId: 9,
      args: { plan: true, packageScripts: { typecheck: 'tsc --noEmit', test: 'vitest run' }, writtenPaths: ['src/a.ts'] },
      tenantId: 1, projectId: 2, taskId: 3, cloudAgentRef: 'agent-x', surface: 'container',
    } as never);

    const body = result.body as { commands: string[] };
    expect(body.commands).toEqual(['npm run typecheck', 'npm run test']);
    // Asking what to run is not a verification: nothing was recorded, nothing written.
    expect(events).toHaveLength(0);
  });
});
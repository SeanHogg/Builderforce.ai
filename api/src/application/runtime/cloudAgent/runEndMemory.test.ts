/**
 * Findings 11 & 12 — what happens AFTER a run finishes.
 *
 * The `verify` phase was DECLARED in the run policy (`verify_started`) and HANDLED by
 * its reducer, but no run loop ever EMITTED it — so the policy meant to gate runs on a
 * verify step never saw one. Separately nothing committed what a run learned, so runs
 * taught the system nothing.
 *
 * These tests pin the two behaviours of the run-end tail every cloud run takes (the one
 * engine's `runVerifyThenRemember`, which the sandbox's own checks feed):
 *   - verifying emits `verify_started` + the paired completion event, in order;
 *   - memory is committed AFTER the verdict, through the EXISTING memory API;
 *   - and a failing memory write never changes the verdict the run finishes with.
 */
import { describe, expect, it } from 'vitest';
import { commitRunMemory, recordRunVerifyEvents } from './runEndMemory';
import { applyVerifyPhase, describeVerifyOutcome, inRunVerifyOutcome, planInRunVerify, runVerifyPhase } from '@builderforce/agent-run';
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
      surface: 'sandbox',
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
      surface: 'sandbox',
      writtenPaths: ['a.ts'],
      packageScripts: { test: 'vitest run' },
      results: [{ command: 'npm run test', exitCode: 1 }],
    });
    const note = describeVerifyOutcome(outcome);
    expect(note).toMatch(/test/);
    expect(note).toMatch(/1 failed/);
  });

  it('has a note for every outcome shape, including the skipped one', () => {
    const surfaces = ['durable', 'sandbox', 'on-prem'] as const;
    for (const surface of surfaces) {
      for (const writtenPaths of [[], ['a.ts']]) {
        const outcome = inRunVerifyOutcome({ surface, writtenPaths, results: null });
        expect(typeof outcome.mayFinish).toBe('boolean');
        expect(describeVerifyOutcome(outcome).length).toBeGreaterThan(0);
      }
    }
  });
});

describe('the verify plan a sandboxed run executes', () => {
  it('never invents a script the manifest does not declare', () => {
    const plan = planInRunVerify({ surface: 'sandbox', packageScripts: { build: 'tsc' } });
    expect(plan.commands).toEqual([]);
  });

  it('reports honestly when there is no shell to run checks in', () => {
    const plan = planInRunVerify({ surface: 'durable', packageScripts: { test: 'vitest run' } });
    expect(plan.kind).toBe('skipped');
    expect(plan.reason).toBe('no_shell');
  });
});

describe('the run-end tail: events, then memory (findings 11 & 12)', () => {
  /**
   * A DB stub that records what a run wrote. Two different writes land here:
   *  - the run's timeline, via `recordCloudToolEvent` — `insert().values(row).returning()`,
   *    with the event's detail JSON-stringified into the row's `args` column;
   *  - the run's learning, via the existing memory API — `insert().values(fact)`
   *    terminated by `.onConflictDoUpdate()`, on the project-facts table.
   * Both go through Drizzle, so the stub intercepts that chain and keeps the rows.
   */
  function stubDb() {
    const events: Array<{ toolName: string; category: string; detail?: unknown }> = [];
    const facts: Array<Record<string, unknown>> = [];
    const values = (row: Record<string, unknown>) => ({
      returning: async () => {
        events.push({
          toolName: String(row.toolName ?? ''),
          category: String(row.category ?? ''),
          detail: typeof row.args === 'string' ? JSON.parse(row.args) : row.args,
        });
        return [{ id: events.length }];
      },
      onConflictDoUpdate: async () => {
        // A remembered fact: no toolName, but a key and a content body.
        if (!('toolName' in row)) facts.push(row);
        return undefined;
      },
    });
    const db = {
      insert: () => ({ values }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
      prepare: () => ({ bind: () => ({ first: async () => null, run: async () => undefined, all: async () => ({ results: [] }) }) }),
    } as never;
    return { events, facts, db };
  }

  const env = { KV: { get: async () => null, put: async () => undefined } } as never;
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('emits verify_started and the paired completion, then commits memory', async () => {
    const { db, events, facts } = stubDb();
    // The sandbox ran the declared check; the run-end tail records it, then remembers.
    const outcome = runVerifyPhase({
      surface: 'sandbox',
      writtenPaths: ['src/a.ts'],
      packageScripts: { typecheck: 'tsc --noEmit' },
      results: [{ command: 'npm run typecheck', exitCode: 0 }],
    });
    recordRunVerifyEvents({ db, tenantId: 1, executionId: 7, cloudAgentRef: 'agent-x' }, outcome);
    await flush();
    await commitRunMemory({
      db, env, tenantId: 1, projectId: 2, ticketId: 3, executionId: 7, cloudAgentRef: 'agent-x',
      summary: 'Added the parser to the canvas loader.',
      verifyNote: describeVerifyOutcome(outcome),
      writtenPaths: ['src/a.ts'],
    });

    // The verdict is the run's own result.
    expect(outcome.mayFinish).toBe(true);

    // The run's timeline observed the DECLARED verify phase, then its completion.
    const names = events.map((e) => `${e.toolName}:${JSON.stringify(e.detail)}`);
    expect(names.some((n) => n.startsWith('run_policy:') && n.includes('verify_started'))).toBe(true);
    const startedAt = names.findIndex((n) => n.includes('verify_started'));
    const completedAt = names.findIndex((n) => n.startsWith('in_run_verify:'));
    expect(startedAt).toBeGreaterThanOrEqual(0);
    expect(completedAt).toBeGreaterThan(startedAt);

    // And the run committed what it learned, through the EXISTING memory API —
    // ONE fact, keyed per run, carrying the summary, the verify note and the files
    // it touched, stamped with the execution that produced it.
    expect(facts).toHaveLength(1);
    const fact = facts[0]!;
    expect(fact.key).toBe('run-outcome:ticket-3:7');
    expect(String(fact.content)).toContain('Added the parser to the canvas loader.');
    expect(String(fact.content)).toContain('verify ran: npm run typecheck');
    expect(String(fact.content)).toContain('changed: src/a.ts');
    expect(fact.origin).toBe('cloud-run');
    expect(fact.originExecutionId).toBe(7);
    expect(fact.tenantId).toBe(1);
    expect(fact.scopeKind).toBe('ticket');
    expect(fact.scopeId).toBe(3);
  });

  it('keeps the run result when the memory write fails', async () => {
    // Every statement through this DB throws — the memory write cannot land.
    const failing = { prepare: () => { throw new Error('memory backend down'); }, batch: async () => { throw new Error('memory backend down'); } } as never;
    const outcome = runVerifyPhase({ surface: 'sandbox', writtenPaths: ['src/a.ts'], results: [{ command: 'npm run test', exitCode: 0 }] });
    await expect(commitRunMemory({
      db: failing, env, tenantId: 1, projectId: 2, ticketId: 3, executionId: 8,
      summary: 'did the work', verifyNote: describeVerifyOutcome(outcome), writtenPaths: ['src/a.ts'],
    })).resolves.toBeDefined();
    // Losing memory must not lose the run's verdict.
    expect(outcome.mayFinish).toBe(true);
  });

  it('plans only declared checks, and planning records nothing', async () => {
    const plan = planInRunVerify({ surface: 'sandbox', packageScripts: { typecheck: 'tsc --noEmit', test: 'vitest run' } });
    expect(plan.commands).toEqual(['npm run typecheck', 'npm run test']);
  });
});

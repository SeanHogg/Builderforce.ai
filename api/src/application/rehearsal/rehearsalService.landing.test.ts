/**
 * runRehearsal lands its shadow execution through the ONE terminal transition, FIRST, handing it the run's final tally: the execution's
 * outcome row is written exactly once (with the counts) beside exactly one run.finished, and the rehearsal row only flips afterwards - a
 * landing that throws can never leave rehearsal=completed beside a live execution, nor rehearsal=failed beside a completed one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  engineResult: { ok: true, output: 'rehearsed', cancelled: false, finished: true } as Record<string, unknown>,
  report: vi.fn(),
}));
vi.mock('../observability/caughtErrorReporter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../observability/caughtErrorReporter')>()),
  reportCaughtError: h.report,
}));
vi.mock('../prd/taskPrd', () => ({ findTaskPrimarySpec: async () => ({ prd: 'a prd' }) }));
vi.mock('../agentIdentity/agentRunIdentity', () => ({ freezeIdeAgentDefinition: async () => null }));
vi.mock('../runtime/cloudAgentEngine', () => ({
  prepareCloudRun: async () => ({ systemPrompt: 's', userContent: 'u', execParams: undefined }),
  resolveAgentEngine: () => ({ run: async () => h.engineResult }),
}));

import { runRehearsal } from './rehearsalService';
import { buildExecutionRepository } from '../../buildExecutionRepository';
import { executions, rehearsals, toolAuditEvents } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

const TALLY = { toolCalls: 6, toolErrors: 1, tokens: 1200, cacheReadTokens: 0, shellFileReads: 0, repoErrors: 0, model: 'm-1' };

const executionRow = (status: string) => ({
  id: 41, taskId: 5, agentId: null, agentRegistrationId: null, agentHostId: null, tenantId: 4, submittedBy: 'rehearsal:dry_run', sessionId: null, status,
  payload: null, source: 'agent', cloudAgentRef: null, result: null, errorMessage: null, produced: null, startedAt: null, completedAt: null,
  createdAt: new Date(0), updatedAt: new Date(0),
});

/** The rehearsal's database: records every write in order; `landFails` makes the execution's terminal UPDATE throw. */
function fakeDb(opts: { landFails?: boolean; completedElsewhere?: boolean } = {}) {
  const order: string[] = [];
  let completionFailed = false;
  const rehearsalSets: Array<Record<string, unknown>> = [];
  const timeline: Array<Record<string, unknown>> = [];
  const selectChain = (rows: unknown[]) => {
    const chain: Record<string, unknown> = {};
    for (const m of ['from', 'innerJoin', 'where', 'limit']) chain[m] = () => chain;
    chain.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) => Promise.resolve(rows).then(ok, err);
    return chain;
  };
  const db = {
    // `completedElsewhere`: the run's own row reads COMPLETED (another writer landed it) - the ticket and the execution share one fake row.
    select: () => selectChain([{ ...(opts.completedElsewhere ? { ...executionRow('completed'), result: 'landed by someone else' } : {}), id: 5, title: 'T', description: null, projectId: 3, assignedAgentRef: null }]),
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown> | Array<Record<string, unknown>>) => {
        const list = Array.isArray(v) ? v : [v];
        if (table === toolAuditEvents) { order.push('timeline'); timeline.push(...list); }
        return Object.assign(Promise.resolve(undefined), {
          returning: async () => (table === rehearsals ? [{ id: 'reh-1' }] : table === executions ? [{ id: 41 }] : []),
          onConflictDoNothing: () => ({ returning: async () => list.map((r) => ({ executionId: r.executionId })) }),
        });
      },
    }),
    update: (table: unknown) => ({
      set: (vals: Record<string, unknown>) => ({
        where: () => {
          if (table === rehearsals) {
            order.push(`rehearsal:${String(vals.status ?? 'link')}`);
            // The FIRST completion write fails: the run is then failed -> found already completed, and the row is written from there.
            if (opts.completedElsewhere && vals.status === 'completed' && !completionFailed) { completionFailed = true; return Promise.reject(new Error('rehearsal write hiccup')); }
            rehearsalSets.push(vals);
            return Promise.resolve([]);
          }
          order.push(`execution:${String(vals.status)}`);
          return { returning: async () => { if (opts.landFails && vals.status === 'completed') throw new Error('db hiccup'); return opts.completedElsewhere ? [] : [executionRow(String(vals.status))]; } };
        },
      }),
    }),
  } as unknown as Db;
  return { db, order, rehearsalSets, timeline };
}

beforeEach(() => { h.report.mockClear(); h.engineResult = { ok: true, output: 'rehearsed', cancelled: false, finished: true }; });

describe('runRehearsal - the shadow execution lands first, with the run\'s tally', () => {
  it('writes exactly one run.outcome (WITH counts) and one run.finished, and flips the rehearsal row after the landing', async () => {
    h.engineResult = { ...h.engineResult, telemetry: TALLY };
    const { db, order, rehearsalSets, timeline } = fakeDb();

    await runRehearsal({} as Env, db, { tenantId: 4, kind: 'dry_run', taskId: 5 }, buildExecutionRepository(db));

    const outcomes = timeline.filter((r) => r.toolName === 'run.outcome');
    expect(outcomes).toHaveLength(1);
    expect(JSON.parse(String(outcomes[0]!.args))).toMatchObject({ entryPoint: 'cloud', terminalStatus: 'finished', toolCalls: 6, toolErrors: 1, tokens: 1200, model: 'm-1' });
    expect(timeline.filter((r) => r.toolName === 'run.finished')).toHaveLength(1);
    expect(order.indexOf('execution:completed')).toBeGreaterThan(-1);
    expect(order.indexOf('execution:completed')).toBeLessThan(order.indexOf('rehearsal:completed'));
    expect(rehearsalSets.at(-1)).toMatchObject({ status: 'completed' });
    expect(h.report).not.toHaveBeenCalled();
  });

  it('a landing that throws leaves rehearsal=failed beside execution=failed - never completed beside failed or the reverse', async () => {
    const { db, order, rehearsalSets } = fakeDb({ landFails: true });

    await runRehearsal({} as Env, db, { tenantId: 4, kind: 'dry_run', taskId: 5 }, buildExecutionRepository(db));

    expect(order).not.toContain('rehearsal:completed'); // the rehearsal never claimed success before the execution landed
    expect(order.indexOf('execution:failed')).toBeLessThan(order.lastIndexOf('rehearsal:failed'));
    expect(rehearsalSets.at(-1)).toMatchObject({ status: 'failed', errorMessage: 'db hiccup' });
  });

  it('a failure that finds the execution already COMPLETED writes the same completion fields as a normal finish (steps, summary, finishedOk)', async () => {
    const { db, rehearsalSets } = fakeDb({ completedElsewhere: true });

    await runRehearsal({} as Env, db, { tenantId: 4, kind: 'dry_run', taskId: 5 }, buildExecutionRepository(db));

    expect(rehearsalSets.at(-1)).toMatchObject({ status: 'completed', steps: 0, suppressedWrites: 0, finishedOk: true, summary: 'rehearsed' });
    expect(rehearsalSets.at(-1)).not.toHaveProperty('errorMessage');
  });
});

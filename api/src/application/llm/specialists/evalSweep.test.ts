import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../env';
import type { Db } from '../../../infrastructure/database/connection';
import type { SpecialistEvalCase } from './evalCaseStore';

const { cases, listEvalCases, storeReferenceOutput, recordAdmissionVerdict, invalidateCached } = vi.hoisted(() => {
  const cases = new Map<string, SpecialistEvalCase[]>();
  return {
    cases,
    listEvalCases: vi.fn(async (_db: unknown, jobId: string) => (cases.get(jobId) ?? []).map((c) => ({ ...c }))),
    storeReferenceOutput: vi.fn(async () => undefined),
    recordAdmissionVerdict: vi.fn(async (_db: unknown, v: { admitted: boolean }) => (v.admitted ? 'admitted' : 'unchanged')),
    invalidateCached: vi.fn(async () => undefined),
  };
});

vi.mock('./evalCaseStore', () => ({ listEvalCases, storeReferenceOutput }));
vi.mock('./admissionStore', () => ({ recordAdmissionVerdict, SPECIALIST_ADMISSIONS_CACHE_KEY: 'k' }));
vi.mock('../../../infrastructure/cache/readThroughCache', async (importOriginal) => ({ ...(await importOriginal<object>()), invalidateCached }));

import { runSpecialistEvalSweep, describeSpecialistSweep } from './evalSweep';

const ON = { COST_LEVER_E2_SPECIALISTS: 'on' } as unknown as Env;
const OFF = { COST_LEVER_E2_SPECIALISTS: 'off' } as unknown as Env;
const db = {} as Db;

const classifierCase = (id: number, reference: string | null): SpecialistEvalCase => ({
  id,
  request: { messages: [{ role: 'system', content: 'classify' }, { role: 'user', content: `ticket ${id}` }] },
  referenceOutput: reference,
});

/** Ports where every model answers by a per-model rule. */
function ports(answer: (model: string, user: string) => string | null) {
  return {
    complete: vi.fn(async (model: string, req: { messages: Array<{ content: string }> }) => answer(model, req.messages.at(-1)!.content)),
    judgeFor: () => async () => '',
    now: () => new Date('2026-10-26T08:00:00Z'),
  };
}

beforeEach(() => {
  cases.clear();
  vi.clearAllMocks();
});

describe('runSpecialistEvalSweep', () => {
  it('does nothing with the lever fully off', async () => {
    const p = ports(() => 'x');
    expect(await runSpecialistEvalSweep(OFF, db, p)).toEqual({ skipped: true, jobs: [] });
    expect(listEvalCases).not.toHaveBeenCalled();
  });

  it('gives no verdict on too few cases, so existing admissions stand', async () => {
    cases.set('task_action_type', [classifierCase(1, '{"action_type":"bugfix"}')]);
    const r = await runSpecialistEvalSweep(ON, db, ports(() => '{"action_type":"bugfix"}'));
    expect(r.jobs.find((j) => j.jobId === 'task_action_type')).toMatchObject({ status: 'insufficient_cases', cases: 1 });
    expect(recordAdmissionVerdict).not.toHaveBeenCalled();
  });

  it('fills missing references from the frontier, then admits a candidate at parity and refuses one below it', async () => {
    cases.set('task_action_type', Array.from({ length: 20 }, (_, i) => classifierCase(i + 1, null)));
    const r = await runSpecialistEvalSweep(ON, db, ports((model, user) => {
      if (model === 'claude-sonnet-5') return '{"action_type":"bugfix"}';
      // qwen agrees on every case; llama only on the even ones.
      if (model.includes('qwen')) return '{"action_type":"bugfix"}';
      return Number(user.split(' ')[1]) % 2 === 0 ? '{"action_type":"bugfix"}' : '{"action_type":"docs"}';
    }));
    expect(storeReferenceOutput).toHaveBeenCalledTimes(20);
    const job = r.jobs.find((j) => j.jobId === 'task_action_type')!;
    expect(job.status).toBe('evaluated');
    const byModel = Object.fromEntries(recordAdmissionVerdict.mock.calls.map(([, v]) => [(v as unknown as { model: string }).model, v as unknown as { admitted: boolean; score: number; frontierScore: number }]));
    expect(byModel['@cf/qwen/qwen3-30b-a3b-fp8']).toMatchObject({ admitted: true, score: 1, frontierScore: 1 });
    expect(byModel['@cf/meta/llama-3.1-8b-instruct-fp8']).toMatchObject({ admitted: false, score: 0.5 });
    expect(invalidateCached).toHaveBeenCalledWith(ON, 'k');
    expect(describeSpecialistSweep(r)).toContain('task_action_type:evaluated');
  });

  it('stops at the wall-clock budget without a verdict', async () => {
    cases.set('task_action_type', Array.from({ length: 20 }, (_, i) => classifierCase(i + 1, '{"action_type":"bugfix"}')));
    const r = await runSpecialistEvalSweep(ON, db, ports(() => '{"action_type":"bugfix"}'), -1);
    expect(r.jobs.find((j) => j.jobId === 'task_action_type')?.status).toBe('out_of_time');
    expect(recordAdmissionVerdict).not.toHaveBeenCalled();
  });
});

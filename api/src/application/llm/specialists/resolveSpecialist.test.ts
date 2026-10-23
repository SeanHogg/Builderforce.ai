import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../env';
import { __clearL1CacheForTests } from '../../../infrastructure/cache/readThroughCache';
import { pickAdmission, resolveSpecialist } from './resolveSpecialist';
import type { SpecialistAdmission } from './admissionStore';

const admission = (over: Partial<SpecialistAdmission> = {}): SpecialistAdmission => ({
  jobId: 'compaction_summary',
  model: '@cf/meta/llama-3.1-8b-instruct-fp8',
  dataset: 'specialist:compaction_summary',
  cases: 20,
  score: 0.81,
  frontierScore: 0.9,
  frontierModel: 'claude-sonnet-5',
  admittedAt: '2026-10-19T08:00:00.000Z',
  evaluatedAt: '2026-10-19T08:00:00.000Z',
  ...over,
});

const ON = { COST_LEVER_E2_SPECIALISTS: 'on' } as unknown as Env;
const OFF = { COST_LEVER_E2_SPECIALISTS: 'off' } as unknown as Env;

beforeEach(() => __clearL1CacheForTests());

describe('pickAdmission', () => {
  it('picks the best ratio for the job and ignores other jobs', () => {
    const pick = pickAdmission([
      admission({ model: 'a', score: 0.81 }),
      admission({ model: 'b', score: 0.88 }),
      admission({ jobId: 'task_action_type', model: 'c', score: 1, frontierScore: 1 }),
    ], 'compaction_summary');
    expect(pick?.model).toBe('b');
    expect(pick?.ratio).toBeCloseTo(0.88 / 0.9);
  });

  it('is null when nothing is admitted for the job', () => {
    expect(pickAdmission([admission()], 'task_action_type')).toBeNull();
    expect(pickAdmission([], 'compaction_summary')).toBeNull();
  });
});

describe('resolveSpecialist', () => {
  it('is null with the lever off and never reads admissions', async () => {
    const load = vi.fn(async () => [admission()]);
    expect(await resolveSpecialist(OFF, 7, 'compaction_summary', { load })).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('returns the admitted model with the lever on', async () => {
    const choice = await resolveSpecialist(ON, 7, 'compaction_summary', { load: async () => [admission()] });
    expect(choice).toMatchObject({ jobId: 'compaction_summary', model: '@cf/meta/llama-3.1-8b-instruct-fp8' });
  });

  it('degrades to null when the read fails — the caller keeps today\'s model', async () => {
    const choice = await resolveSpecialist(ON, 7, 'compaction_summary', { load: async () => { throw new Error('neon down'); } });
    expect(choice).toBeNull();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { judgeMaterials, scoreJob, specialistDataset, type ScoredPair } from './scoring';
import { specialistJob } from './registry';
import type { SpecialistRequest } from './evalCaseStore';

const request = (user: string): SpecialistRequest => ({
  messages: [{ role: 'system', content: 'Compress the transcript.' }, { role: 'user', content: user }],
  max_tokens: 700,
});
const pair = (id: number, reference: string, candidate: string | null): ScoredPair => ({
  evalCase: { id, request: request(`case ${id}`), referenceOutput: reference },
  candidate,
});
const verdict = (score: number): string =>
  JSON.stringify({ faithfulness: score, answer_relevance: score, context_relevance: score, hallucination_rate: 1 - score });

describe('judgeMaterials', () => {
  it('asks the case instruction of the case input', () => {
    expect(judgeMaterials(request('the transcript'), 'the memory')).toEqual({ question: 'Compress the transcript.', context: 'the transcript', answer: 'the memory' });
  });
});

describe('scoreJob — label jobs', () => {
  const job = specialistJob('task_action_type');

  it('scores agreement with the frontier label; the frontier scores 1 on its own labels', async () => {
    const scores = await scoreJob(job, [
      pair(1, '{"action_type":"bugfix"}', '{"action_type":"bugfix"}'),
      pair(2, '{"action_type":"tests"}', '{"action_type":"docs"}'),
      pair(3, '{"action_type":"docs"}', null),
      pair(4, 'not json', '{"action_type":"docs"}'),
    ], async () => '');
    expect(scores.frontier).toEqual({ dataset: specialistDataset('task_action_type'), meanScore: 1, cases: 3 });
    expect(scores.candidate.cases).toBe(3);
    expect(scores.candidate.meanScore).toBeCloseTo(1 / 3);
  });
});

describe('scoreJob — judge jobs', () => {
  const job = specialistJob('compaction_summary');

  it('judges both sides on the same cases and memoises the frontier verdict', async () => {
    const judge = vi.fn(async (prompt: string) => verdict(prompt.includes('ANSWER:\nREF') ? 0.9 : 0.6));
    const memo = new Map<number, number | null>();
    const first = await scoreJob(job, [pair(1, 'REF one', 'cand one'), pair(2, 'REF two', 'cand two')], judge, memo);
    expect(first.frontier.cases).toBe(2);
    expect(first.candidate.cases).toBe(2);
    expect(first.frontier.meanScore).toBeGreaterThan(first.candidate.meanScore);
    const calls = judge.mock.calls.length;
    await scoreJob(job, [pair(1, 'REF one', 'other'), pair(2, 'REF two', 'other')], judge, memo);
    // Second candidate: only its own two outputs are judged.
    expect(judge.mock.calls.length - calls).toBe(2);
  });

  it('scores a failed candidate call as a miss, and drops a case the judge could not rate', async () => {
    const judge = vi.fn(async (prompt: string) => (prompt.includes('case 2') ? 'no json here' : verdict(0.8)));
    const scores = await scoreJob(job, [pair(1, 'REF', null), pair(2, 'REF', 'cand')], judge);
    expect(scores.frontier.cases).toBe(1);
    expect(scores.candidate).toMatchObject({ cases: 1, meanScore: 0 });
  });
});

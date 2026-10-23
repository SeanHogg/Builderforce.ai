import { describe, expect, it } from 'vitest';
import { actionTypeLabel, SPECIALIST_JOBS, specialistBar, specialistJob } from './registry';
import { FRONTIER_PARITY_BAR } from './admission';
import { catalogEntry } from '../vendors/registry';

describe('SPECIALIST_JOBS', () => {
  it('has unique job ids, each resolvable', () => {
    const ids = SPECIALIST_JOBS.map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(specialistJob(id).id).toBe(id);
  });

  it('names only models the live catalog knows — a stale id would 404 every replay', () => {
    for (const job of SPECIALIST_JOBS) {
      for (const model of [...job.candidates, job.referenceModel]) expect(catalogEntry(model), `${job.id}: ${model}`).toBeTruthy();
    }
  });

  it('keeps eval sets bounded and coherent', () => {
    for (const job of SPECIALIST_JOBS) {
      expect(job.evalSet.minCases).toBeGreaterThan(0);
      expect(job.evalSet.maxCases).toBeGreaterThanOrEqual(job.evalSet.minCases);
      expect(job.evalSet.captureRate).toBeGreaterThan(0);
      expect(job.evalSet.captureRate).toBeLessThanOrEqual(1);
      expect(specialistBar(job)).toBe(FRONTIER_PARITY_BAR);
    }
  });

  it('throws on an unknown job', () => {
    expect(() => specialistJob('nope' as never)).toThrow(/unknown specialist job/);
  });
});

describe('actionTypeLabel', () => {
  it('reads the classifier JSON label', () => {
    expect(actionTypeLabel('{"action_type":"bugfix","confidence":0.8}')).toBe('bugfix');
    expect(actionTypeLabel('Sure: {"action_type": "tests"}')).toBe('tests');
  });

  it('has no label for prose, bad JSON or an unknown type', () => {
    expect(actionTypeLabel('bugfix')).toBeNull();
    expect(actionTypeLabel('{"action_type":')).toBeNull();
    expect(actionTypeLabel('{"action_type":"rewrite_everything"}')).toBeNull();
  });
});

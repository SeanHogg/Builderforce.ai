import { describe, expect, it } from 'vitest';
import { HUMAN_HOURS_CAP, taskEffortHours, taskLaborUsd } from './laborCost';

const at = (iso: string) => new Date(iso);

describe('taskEffortHours', () => {
  it('prefers logged time over the cycle-time estimate', () => {
    expect(taskEffortHours(90, at('2026-09-01T09:00:00Z'), at('2026-09-01T18:00:00Z'))).toBe(1.5);
  });

  it('caps a finished task without logged time at one work-day', () => {
    expect(taskEffortHours(0, at('2026-09-01T09:00:00Z'), at('2026-09-03T09:00:00Z'))).toBe(HUMAN_HOURS_CAP);
    expect(taskEffortHours(0, at('2026-09-01T09:00:00Z'), at('2026-09-01T11:00:00Z'))).toBe(2);
  });

  it('prices nothing for a task that has not finished and has no logged time', () => {
    expect(taskEffortHours(0, at('2026-09-01T09:00:00Z'), null)).toBe(0);
  });
});

describe('taskLaborUsd', () => {
  it('multiplies effort by the member rate and reports effort even without a rate', () => {
    expect(taskLaborUsd(100, 120, at('2026-09-01T09:00:00Z'), null)).toEqual({ usd: 200, effortHours: 2 });
    expect(taskLaborUsd(null, 120, at('2026-09-01T09:00:00Z'), null)).toEqual({ usd: 0, effortHours: 2 });
  });
});

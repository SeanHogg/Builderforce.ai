import { describe, it, expect } from 'vitest';
import { deriveRiceScore, heuristicBusinessValue, parseValueResponse, buildValuePrompt } from './businessValue';
import type { RankableTask } from './prioritize';

const NOW = Date.parse('2026-07-03T00:00:00Z');
const base: RankableTask = { taskId: 1, priority: 'medium', businessValue: null, dueDate: null, status: 'todo', createdAt: new Date(NOW).toISOString() };

describe('deriveRiceScore', () => {
  it('maps the maximal RICE inputs to 100 and the minimal to 0', () => {
    expect(deriveRiceScore({ reach: 10, impact: 5, confidence: 1, effort: 1 })).toBe(100);
    expect(deriveRiceScore({ reach: 0, impact: 0, confidence: 0, effort: 10 })).toBe(0);
  });
  it('is monotonic in confidence and inverse in effort', () => {
    const lowConf = deriveRiceScore({ reach: 8, impact: 3, confidence: 0.3, effort: 3 });
    const hiConf = deriveRiceScore({ reach: 8, impact: 3, confidence: 0.9, effort: 3 });
    expect(hiConf).toBeGreaterThan(lowConf);
    const cheap = deriveRiceScore({ reach: 8, impact: 3, confidence: 0.9, effort: 1 });
    expect(cheap).toBeGreaterThan(hiConf);
  });
  it('never divides by zero (effort floored at 1) and stays in 0..100', () => {
    const s = deriveRiceScore({ reach: 10, impact: 5, confidence: 1, effort: 0 });
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(100);
  });
});

describe('heuristicBusinessValue', () => {
  it('scores urgent above low and stays in range', () => {
    const urgent = heuristicBusinessValue({ ...base, priority: 'urgent' }, NOW, null);
    const low = heuristicBusinessValue({ ...base, priority: 'low' }, NOW, null);
    expect(urgent.score).toBeGreaterThan(low.score);
    expect(urgent.score).toBeLessThanOrEqual(100);
    expect(low.score).toBeGreaterThanOrEqual(0);
  });
  it('lifts imminent/overdue due dates and always returns a rationale', () => {
    const overdue = heuristicBusinessValue({ ...base, dueDate: new Date(NOW - 86_400_000).toISOString() }, NOW, null);
    const undated = heuristicBusinessValue(base, NOW, null);
    expect(overdue.score).toBeGreaterThan(undated.score);
    expect(overdue.rationale).toBeTruthy();
  });
});

describe('parseValueResponse', () => {
  it('parses a clean JSON reply into a 0..100 score', () => {
    const r = parseValueResponse('{"reach":8,"impact":4,"confidence":0.8,"effort":2,"rationale":"unblocks checkout"}');
    expect(r).not.toBeNull();
    expect(r!.score).toBeGreaterThan(0);
    expect(r!.rationale).toContain('checkout');
    expect(r!.source).toBe('ai');
  });
  it('tolerates code fences and surrounding prose', () => {
    const r = parseValueResponse('Sure!\n```json\n{"reach":5,"impact":3,"confidence":0.5,"effort":4}\n```');
    expect(r).not.toBeNull();
  });
  it('returns null on missing RICE keys or non-JSON', () => {
    expect(parseValueResponse('no json here')).toBeNull();
    expect(parseValueResponse('{"foo":1}')).toBeNull();
  });
});

describe('buildValuePrompt', () => {
  it('includes the title and constrains the JSON shape', () => {
    const p = buildValuePrompt({ title: 'Add SSO', description: null, priority: 'high' });
    expect(p).toContain('Add SSO');
    expect(p).toContain('"reach"');
  });
});

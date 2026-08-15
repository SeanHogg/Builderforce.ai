import { describe, expect, it } from 'vitest';
import { normalizeRatingValue, ratingLeaders, summarizeRatingRows } from './actionRatings';

describe('normalizeRatingValue', () => {
  it('accepts every shape a client might send, and treats anything else as a clear', () => {
    expect(normalizeRatingValue('up')).toBe(1);
    expect(normalizeRatingValue(1)).toBe(1);
    expect(normalizeRatingValue('down')).toBe(-1);
    expect(normalizeRatingValue(-1)).toBe(-1);
    // "No opinion" is the absence of a rating — the row is deleted, never stored as 0.
    expect(normalizeRatingValue(null)).toBe(0);
    expect(normalizeRatingValue('meh')).toBe(0);
    expect(normalizeRatingValue(undefined)).toBe(0);
  });
});

describe('summarizeRatingRows', () => {
  it('scores each bucket and ranks best-first, breaking ties on volume', () => {
    const buckets = summarizeRatingRows([
      { model: 'weak', actionType: 'frontend_ui', toolName: 'canvas_add_object', up: 1, down: 9 },
      { model: 'strong', actionType: 'frontend_ui', toolName: 'canvas_add_object', up: 30, down: 2 },
      { model: 'thin', actionType: 'frontend_ui', toolName: 'canvas_add_object', up: 1, down: 0 },
    ]);
    expect(buckets.map((b) => b.model)).toEqual(['strong', 'thin', 'weak']);
    expect(buckets[0]!.total).toBe(32);
    expect(buckets[0]!.score).toBeGreaterThan(buckets[1]!.score);
  });

  it('normalises an unknown action label and an empty tool rather than storing junk', () => {
    const [bucket] = summarizeRatingRows([
      { model: 'm', actionType: 'not-a-real-bucket', toolName: '', up: 0, down: 0 },
    ]);
    expect(bucket!.actionType).toBe('other');
    expect(bucket!.toolName).toBeNull();
  });
});

describe('ratingLeaders', () => {
  const buckets = summarizeRatingRows([
    { model: 'alpha', actionType: 'frontend_ui', toolName: 'canvas_add_object', up: 20, down: 1 },
    { model: 'beta', actionType: 'frontend_ui', toolName: 'canvas_add_object', up: 4, down: 12 },
    { model: 'alpha', actionType: 'sql', toolName: 'run_query', up: 3, down: 0 },
  ]);

  it('names the winner, the model it beat, and the margin — per action AND tool', () => {
    const leaders = ratingLeaders(buckets);
    expect(leaders).toHaveLength(1);
    expect(leaders[0]!.winner.model).toBe('alpha');
    expect(leaders[0]!.runnerUp.model).toBe('beta');
    expect(leaders[0]!.toolName).toBe('canvas_add_object');
    expect(leaders[0]!.margin).toBeGreaterThan(0);
  });

  it('omits a bucket with only one rated model — "best of one" is not a comparison', () => {
    expect(ratingLeaders(buckets).some((l) => l.toolName === 'run_query')).toBe(false);
  });

  it('does not merge two different tools under the same action type', () => {
    // The two rows below share an action but not a tool; a key that dropped the tool
    // would declare a winner across unrelated work.
    const mixed = summarizeRatingRows([
      { model: 'a', actionType: 'backend_api', toolName: 'tool_one', up: 5, down: 0 },
      { model: 'b', actionType: 'backend_api', toolName: 'tool_two', up: 0, down: 5 },
    ]);
    expect(ratingLeaders(mixed)).toHaveLength(0);
  });
});

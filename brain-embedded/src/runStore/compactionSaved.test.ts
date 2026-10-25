import { describe, expect, it } from 'vitest';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import { HISTORY_TOKEN_BUDGET, transcriptTokens } from '@seanhogg/builderforce-memory/working';
import { compactionSavedTokens, stampOncePerCall } from './compactionSaved';

const msg = (chars: number): ChatCompletionMessage => ({ role: 'user', content: 'x'.repeat(chars) });

describe('compactionSavedTokens', () => {
  it('measures against the history budget, never the whole transcript', () => {
    // A transcript of ~4x the budget compacted to a small working set saves at most
    // budget - working, not transcript - working.
    const full = Array.from({ length: 8 }, () => msg(HISTORY_TOKEN_BUDGET * 2));
    const working = [msg(4_000)];
    expect(transcriptTokens(full)).toBeGreaterThan(HISTORY_TOKEN_BUDGET);
    expect(compactionSavedTokens(full, working)).toBe(HISTORY_TOKEN_BUDGET - transcriptTokens(working));
  });

  it('uses the full transcript when it is under the budget', () => {
    const full = [msg(8_000), msg(8_000)];
    const working = [msg(2_000)];
    expect(compactionSavedTokens(full, working)).toBe(transcriptTokens(full) - transcriptTokens(working));
  });

  it('is never negative', () => {
    expect(compactionSavedTokens([msg(100)], [msg(10_000)])).toBe(0);
    expect(compactionSavedTokens([msg(400_000)], [msg(400_000)], 1_000)).toBe(0);
  });
});

describe('stampOncePerCall', () => {
  it('stamps the first request only; retries ride the plain metadata', () => {
    const next = stampOncePerCall({ memory: 1 }, { memory: 0 });
    expect(next()).toEqual({ memory: 1 });
    expect(next()).toEqual({ memory: 0 });
    expect(next()).toEqual({ memory: 0 });
  });
});

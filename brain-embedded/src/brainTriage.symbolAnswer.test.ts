import { describe, expect, it } from 'vitest';
import { memoryAnswersInTrace, type BrainTraceEvent } from './brainTriage';

describe('memoryAnswersInTrace — the symbol-index answer', () => {
  it('reads a symbols.answer step as a model-free answer from the symbol index', () => {
    const events: BrainTraceEvent[] = [
      { ts: '2026-10-26T00:00:00Z', category: 'recall', label: 'symbols.answer', args: { query: 'where is fooBar defined?' }, result: { source: 'symbol-index', skippedLlm: true } },
      { ts: '2026-10-26T00:00:01Z', category: 'recall', label: 'memory.answer', result: { source: 'qa-cache', skippedLlm: true } },
    ];
    expect(memoryAnswersInTrace(events)).toEqual([{ source: 'symbol-index' }, { source: 'qa-cache' }]);
  });
});

import { describe, it, expect } from 'vitest';
import {
  extractPrompt,
  extractCompletion,
  isPositiveExample,
  toSftRecords,
  toDpoRecords,
  toJsonl,
  type LabeledTrace,
} from './trainingDataset';

function trace(over: Partial<LabeledTrace>): LabeledTrace {
  return {
    traceId: 't1',
    requestBody: JSON.stringify([{ role: 'user', content: 'do X' }]),
    responseBody: 'did X',
    model: 'evermind/base',
    actionType: 'code',
    score: 0.9,
    merged: true,
    ciGreen: true,
    humanRejected: false,
    terminalStatus: 'completed',
    ...over,
  };
}

describe('extractPrompt', () => {
  it('joins non-assistant messages from a messages array', () => {
    const body = JSON.stringify([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'add a button' },
      { role: 'assistant', content: 'ok' },
    ]);
    const p = extractPrompt(body);
    expect(p).toContain('be terse');
    expect(p).toContain('add a button');
    expect(p).not.toContain('ok'); // assistant turn excluded
  });

  it('handles a { messages } envelope and array-of-parts content', () => {
    const body = JSON.stringify({ messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] });
    expect(extractPrompt(body)).toBe('hello');
  });

  it('falls back to raw text for non-JSON', () => {
    expect(extractPrompt('just a string')).toBe('just a string');
    expect(extractPrompt(null)).toBe('');
  });
});

describe('extractCompletion', () => {
  it('reads Anthropic content arrays', () => {
    expect(extractCompletion(JSON.stringify({ content: [{ type: 'text', text: 'answer' }] }))).toBe('answer');
  });
  it('reads OpenAI choices', () => {
    expect(extractCompletion(JSON.stringify({ choices: [{ message: { content: 'answer' } }] }))).toBe('answer');
  });
  it('reads plain string and { text }', () => {
    expect(extractCompletion('plain')).toBe('plain');
    expect(extractCompletion(JSON.stringify({ text: 'x' }))).toBe('x');
  });
});

describe('isPositiveExample', () => {
  it('accepts a high-score completed run', () => {
    expect(isPositiveExample(trace({}))).toBe(true);
  });
  it('rejects low score, non-completed, or human-rejected', () => {
    expect(isPositiveExample(trace({ score: 0.5 }))).toBe(false);
    expect(isPositiveExample(trace({ terminalStatus: 'failed' }))).toBe(false);
    expect(isPositiveExample(trace({ humanRejected: true }))).toBe(false);
  });
  it('honours requireMerged / requireCiGreen', () => {
    expect(isPositiveExample(trace({ merged: false }), { requireMerged: true })).toBe(false);
    expect(isPositiveExample(trace({ ciGreen: false }), { requireCiGreen: true })).toBe(false);
  });
});

describe('toSftRecords', () => {
  it('keeps positives, dedupes by traceId, drops empty text', () => {
    const rows = [
      trace({ traceId: 'a' }),
      trace({ traceId: 'a' }), // dup
      trace({ traceId: 'b', score: 0.2 }), // filtered out
      trace({ traceId: 'c', responseBody: '' }), // empty completion
    ];
    const recs = toSftRecords(rows);
    expect(recs).toHaveLength(1);
    expect(recs[0]!.meta.model).toBe('evermind/base');
    expect(recs[0]!.completion).toBe('did X');
  });
});

describe('toDpoRecords', () => {
  it('pairs high vs low completion for the SAME prompt above the margin', () => {
    const rows = [
      trace({ traceId: 'a', requestBody: JSON.stringify([{ role: 'user', content: 'task' }]), responseBody: 'good', score: 0.9 }),
      trace({ traceId: 'b', requestBody: JSON.stringify([{ role: 'user', content: 'task' }]), responseBody: 'bad', score: 0.2 }),
    ];
    const pairs = toDpoRecords(rows);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.chosen).toBe('good');
    expect(pairs[0]!.rejected).toBe('bad');
    expect(pairs[0]!.meta.margin).toBeCloseTo(0.7, 5);
  });

  it('skips prompts with a single completion or below-margin spread', () => {
    const single = [trace({ traceId: 'a' })];
    expect(toDpoRecords(single)).toHaveLength(0);
    const tight = [
      trace({ traceId: 'a', responseBody: 'x', score: 0.62 }),
      trace({ traceId: 'b', responseBody: 'y', score: 0.6 }),
    ];
    expect(toDpoRecords(tight, { minMargin: 0.3 })).toHaveLength(0);
  });
});

describe('toJsonl', () => {
  it('emits one JSON object per line', () => {
    const jsonl = toJsonl(toSftRecords([trace({ traceId: 'a' }), trace({ traceId: 'b' })]));
    const lines = jsonl.split('\n');
    expect(lines).toHaveLength(2);
    expect(() => JSON.parse(lines[0]!)).not.toThrow();
  });
});

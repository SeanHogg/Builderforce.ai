import { describe, it, expect } from 'vitest';
import { parseDatasetResponse, serialiseDataset, type GeneratedDataset } from '../services/dataset';

// ---------------------------------------------------------------------------
// parseDatasetResponse
// ---------------------------------------------------------------------------

describe('parseDatasetResponse', () => {
  it('parses a clean JSON array', () => {
    const json = JSON.stringify([
      { instruction: 'Write a function', input: '', output: 'def fn(): pass' },
      { instruction: 'Fix the bug', input: 'x = 1 +', output: 'x = 1 + 1' },
    ]);
    const result = parseDatasetResponse(json, 'Python coding');
    expect(result.examples).toHaveLength(2);
    expect(result.examples[0].instruction).toBe('Write a function');
    expect(result.capability).toBe('Python coding');
  });

  it('strips markdown code fences', () => {
    const json = '```json\n[{"instruction":"test","input":"","output":"ok"}]\n```';
    const result = parseDatasetResponse(json, 'Test');
    expect(result.examples).toHaveLength(1);
    expect(result.examples[0].instruction).toBe('test');
  });

  it('extracts JSON array from surrounding text', () => {
    const text = 'Here are the examples:\n[{"instruction":"hi","input":"","output":"hello"}]\nEnd.';
    const result = parseDatasetResponse(text, 'Test');
    expect(result.examples).toHaveLength(1);
  });

  it('filters out examples with empty instruction', () => {
    const json = JSON.stringify([
      { instruction: '', input: '', output: 'some output' },
      { instruction: 'Valid instruction', input: '', output: 'valid output' },
    ]);
    const result = parseDatasetResponse(json, 'Test');
    expect(result.examples).toHaveLength(1);
    expect(result.examples[0].instruction).toBe('Valid instruction');
  });

  it('filters out examples with empty output', () => {
    const json = JSON.stringify([
      { instruction: 'Some instruction', input: '', output: '' },
      { instruction: 'Good instruction', input: '', output: 'good output' },
    ]);
    const result = parseDatasetResponse(json, 'Test');
    expect(result.examples).toHaveLength(1);
  });

  it('throws when no JSON array is present', () => {
    expect(() => parseDatasetResponse('No JSON here', 'Test')).toThrow();
  });

  it('handles missing optional input field', () => {
    const json = JSON.stringify([{ instruction: 'Do something', output: 'result' }]);
    const result = parseDatasetResponse(json, 'Test');
    expect(result.examples[0].input).toBe('');
  });
});

// ---------------------------------------------------------------------------
// serialiseDataset
// ---------------------------------------------------------------------------

describe('serialiseDataset', () => {
  it('produces one JSONL line per example', () => {
    const dataset: GeneratedDataset = {
      capability: 'Test',
      examples: [
        { instruction: 'Inst 1', input: 'In 1', output: 'Out 1' },
        { instruction: 'Inst 2', input: 'In 2', output: 'Out 2' },
      ],
    };
    const lines = serialiseDataset(dataset).split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual(dataset.examples[0]);
    expect(JSON.parse(lines[1])).toEqual(dataset.examples[1]);
  });

  it('returns empty string for empty dataset', () => {
    const dataset: GeneratedDataset = { capability: 'Test', examples: [] };
    expect(serialiseDataset(dataset)).toBe('');
  });

  it('produces valid JSON for each line', () => {
    const dataset: GeneratedDataset = {
      capability: 'Test',
      examples: [
        { instruction: 'Test with "quotes"', input: '', output: 'output with\nnewline' },
      ],
    };
    const lines = serialiseDataset(dataset).split('\n');
    expect(() => JSON.parse(lines[0])).not.toThrow();
  });
});

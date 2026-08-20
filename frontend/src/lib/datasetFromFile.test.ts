/**
 * Contract tests for corpus recognition.
 *
 * The rule that matters is the STRICTNESS: a `.jsonl` in the workspace that is
 * not an instruction corpus must stay an ordinary file. A loose matcher here
 * would silently register a user's log file or config stream as trainable data
 * and put it in front of the fine-tune picker.
 */
import { describe, it, expect } from 'vitest';
import { datasetNameForPath, looksLikeDatasetPath, parseJsonlDataset } from './datasetFromFile';

describe('looksLikeDatasetPath', () => {
  it.each(['data/train.jsonl', 'a.ndjson', 'nested/dir/CORPUS.JSONL'])('accepts %s', (p) => {
    expect(looksLikeDatasetPath(p)).toBe(true);
  });
  it.each(['package.json', 'src/App.jsx', 'notes.md', 'jsonl', 'data.jsonl.bak'])('rejects %s', (p) => {
    expect(looksLikeDatasetPath(p)).toBe(false);
  });
});

describe('parseJsonlDataset', () => {
  it('parses instruction/output rows, keeping an optional input', () => {
    const rows = parseJsonlDataset(
      '{"instruction":"Greet","output":"Hi"}\n{"instruction":"Add","input":"1+1","output":"2"}\n',
    );
    expect(rows).toEqual([
      { instruction: 'Greet', output: 'Hi' },
      { instruction: 'Add', input: '1+1', output: '2' },
    ]);
  });

  it('tolerates blank lines between rows', () => {
    expect(parseJsonlDataset('{"instruction":"a","output":"b"}\n\n\n')).toHaveLength(1);
  });

  it.each([
    ['an empty file', ''],
    ['whitespace only', '   \n\t\n'],
    ['a non-JSON line', '{"instruction":"a","output":"b"}\nnope'],
    ['a JSON array line', '[1,2,3]'],
    ['a scalar line', '"hello"'],
    ['a row missing output', '{"instruction":"a"}'],
    ['a row missing instruction', '{"output":"b"}'],
    ['a non-string instruction', '{"instruction":42,"output":"b"}'],
    ['a blank instruction', '{"instruction":"   ","output":"b"}'],
    ['a blank output', '{"instruction":"a","output":""}'],
    ['a log stream that happens to be JSONL', '{"level":"info","msg":"started"}'],
  ])('returns null for %s', (_label, content) => {
    expect(parseJsonlDataset(content)).toBeNull();
  });

  // One bad row disqualifies the file: registering a partially-parsed corpus
  // would train on a set the user never reviewed.
  it('rejects the whole file when a single row is malformed', () => {
    const good = '{"instruction":"a","output":"b"}\n';
    expect(parseJsonlDataset(good.repeat(50) + '{"instruction":"a"}')).toBeNull();
  });
});

describe('datasetNameForPath', () => {
  it.each([
    ['data/support-replies.jsonl', 'support-replies'],
    ['train.ndjson', 'train'],
    ['a/b/c.jsonl', 'c'],
  ])('%s → %s', (path, expected) => {
    expect(datasetNameForPath(path)).toBe(expected);
  });
});

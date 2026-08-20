/**
 * The dispatch→change projection is a WIRE CONTRACT with the browser worker
 * (frontend/src/lib/browserRuntime/coding.ts `toResultPayload`). These assert the
 * shape it actually emits, plus the degradation path for the prose-only rows that
 * predate it — an old row must contribute nothing, never throw.
 */
import { describe, expect, it } from 'vitest';
import { parseDispatchChangedFiles } from './taskFileChangeFeed';

describe('parseDispatchChangedFiles', () => {
  it('reads the structured payload the browser worker reports', () => {
    const output = JSON.stringify({
      summary: 'Pushed 2 file(s) to agent/x.',
      branch: 'agent/x',
      files: [
        { path: 'src/a.ts', status: 'modified' },
        { path: 'src/b.ts', status: 'created' },
      ],
    });
    expect(parseDispatchChangedFiles(output)).toEqual([
      { path: 'src/a.ts', change: 'modified' },
      { path: 'src/b.ts', change: 'created' },
    ]);
  });

  it('accepts the bare changedFiles list and defaults its kind', () => {
    const output = JSON.stringify({ summary: 's', changedFiles: ['src/a.ts'] });
    expect(parseDispatchChangedFiles(output)).toEqual([{ path: 'src/a.ts', change: 'modified' }]);
  });

  it('de-duplicates a path present in both lists, keeping the typed entry', () => {
    const output = JSON.stringify({
      files: [{ path: 'src/a.ts', status: 'deleted' }],
      changedFiles: ['src/a.ts'],
    });
    expect(parseDispatchChangedFiles(output)).toEqual([{ path: 'src/a.ts', change: 'deleted' }]);
  });

  it('coerces an unknown status rather than emitting it', () => {
    const output = JSON.stringify({ files: [{ path: 'a', status: 'renamed' }] });
    expect(parseDispatchChangedFiles(output)).toEqual([{ path: 'a', change: 'modified' }]);
  });

  it('contributes nothing for prose output, null, or malformed JSON', () => {
    expect(parseDispatchChangedFiles('Pushed 2 files.\nChanged files:\n  - a.ts')).toEqual([]);
    expect(parseDispatchChangedFiles(null)).toEqual([]);
    expect(parseDispatchChangedFiles('{ not json')).toEqual([]);
    expect(parseDispatchChangedFiles(JSON.stringify({ files: [{ path: '  ' }] }))).toEqual([]);
  });
});

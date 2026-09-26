import { describe, expect, it } from 'vitest';
import { codeChangesOf } from './codeChanges';

/**
 * The ONE reading the code-change backstop takes. A delegated child's writes happen
 * inside a single `spawn_agent` call, so without this reading a child could change the
 * workspace with no ticket opened and no file recorded.
 */
describe('codeChangesOf', () => {
  it('names the file a direct writer changed', () => {
    expect(codeChangesOf('edit_file', { path: 'src/a.ts' }, { ok: true })).toEqual(['src/a.ts']);
  });

  it('still counts a writer with no readable path as a code change', () => {
    expect(codeChangesOf('write_file', {}, { ok: true })).toEqual([]);
  });

  it('reads the files a delegated child changed from the result', () => {
    const out = { ok: true, changedFiles: ['src/a.ts', 'src/b.ts'] };
    expect(codeChangesOf('spawn_agent', { task: 'rename' }, out)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('reads the union a fan-out reports across its workstreams', () => {
    const out = { ok: true, workstreams: [], changedFiles: ['api/a.ts', 'web/b.tsx'] };
    expect(codeChangesOf('spawn_agents', {}, out)).toEqual(['api/a.ts', 'web/b.tsx']);
  });

  it('treats a read-only delegation as no code change', () => {
    expect(codeChangesOf('spawn_agent', { task: 'find' }, { ok: true, output: 'found' })).toBeNull();
  });

  it('reports a failed delegation that had already written, because the files did change', () => {
    // The child wrote, then the delegation failed: the tree moved regardless.
    const out = { ok: false, error: 'the sub-agent stopped without an answer', changedFiles: ['src/a.ts'] };
    expect(codeChangesOf('spawn_agent', {}, out)).toEqual(['src/a.ts']);
  });

  it('yields nothing for a failed write', () => {
    expect(codeChangesOf('edit_file', { path: 'src/a.ts' }, { ok: false, error: 'no match' })).toBeNull();
  });

  it('yields nothing for a tool that does not change code', () => {
    expect(codeChangesOf('read_file', { path: 'src/a.ts' }, { ok: true })).toBeNull();
  });
});

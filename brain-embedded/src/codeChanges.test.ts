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

  it('reads the path from every code-change tool\'s real arg shape, including a batched edit', () => {
    expect(codeChangesOf('delete_file', { path: 'src/old.ts' }, { ok: true })).toEqual(['src/old.ts']);
    for (const tool of ['canvas_write_build_file', 'canvas_edit_build_file', 'canvas_restore_build_file']) {
      expect(codeChangesOf(tool, { path: 'src/App.jsx', objectId: 'o1' }, { ok: true }), tool).toEqual(['src/App.jsx']);
    }
    const batch = { edits: [{ path: 'src/a.ts', old_string: 'x', new_string: 'y' }, { path: 'src/b.ts' }, { path: 'src/a.ts' }] };
    expect(codeChangesOf('edit_file', batch, { ok: true })).toEqual(['src/a.ts', 'src/b.ts']);
    expect(codeChangesOf('edit_file', { edits: [{ path: 'tools/_x.cjs' }, { path: 'src/c.ts' }] }, { ok: true })).toEqual(['src/c.ts']);
  });

  // regression: VS Code chat #275 — the first write was a `_split.cjs` helper in
  // `frontend/`, and the backstop opened "Code change (1 file)" before any real change.
  it('does not count a throwaway helper script as a code change', () => {
    expect(codeChangesOf('write_file', { path: 'frontend/_split.cjs' }, { ok: true })).toBeNull();
    expect(codeChangesOf('write_file', { path: '/tmp/builderforce-scratch/run-9/probe.js' }, { ok: true })).toBeNull();
    expect(codeChangesOf('spawn_agent', {}, { changedFiles: ['frontend/_extract.mjs', 'src/real.ts'] })).toEqual(['src/real.ts']);
    expect(codeChangesOf('spawn_agent', {}, { changedFiles: ['frontend/_extract.mjs'] })).toBeNull();
    // Real project files that merely start with an underscore are still changes.
    expect(codeChangesOf('edit_file', { path: 'pages/_app.ts' }, { ok: true })).toEqual(['pages/_app.ts']);
    expect(codeChangesOf('write_file', { path: 'public/_worker.js' }, { ok: true })).toEqual(['public/_worker.js']);
  });
});

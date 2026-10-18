import { describe, expect, it, vi } from 'vitest';
import { compareAnalysis, normalizeAnalysis, type CodeAnalysisSnapshot } from './codeAnalysis.js';
import { analyzeCodebaseTool, ANALYZERS, parseAnalyzerJson, runCodeAnalysis } from './codeAnalysisTool.js';

const dependency = { modules: [{ source: 'src/a.ts', dependencies: [{ resolved: 'src/b.ts', circular: true }, { resolved: 'node:fs', coreModule: true }] }, { source: 'src/b.ts', dependencies: [] }] };
const duplicates = { duplicates: [{ fragment: 'return input + 1;', firstFile: { name: 'src/a.ts', start: 2, end: 7 }, secondFile: { name: 'src/b.ts', start: 5, end: 10 } }] };
const unused = { files: ['src/dead.ts'], issues: [{ file: 'src/b.ts', exports: [{ name: 'unused', line: 20 }], dependencies: [{ name: 'abandoned-library' }], unlisted: [{ name: 'missing-library' }] }] };
const snapshot = (): CodeAnalysisSnapshot => ({ version: 1, id: 'scan', capturedAt: '2026-10-18T12:00:00.000Z', source: { branch: 'main', commit: 'abc', dirty: false }, tools: ANALYZERS.map((a) => ({ name: a.name, version: a.version, status: 'complete' })), ...normalizeAnalysis(dependency, duplicates, unused) });

describe('measured code analysis', () => {
  it('parses complete JSON surrounded by npm diagnostics and rejects truncated output', () => {
    expect(parseAnalyzerJson('npm warning\n{"files":[],"issues":[]}\nnotice')).toEqual({ files: [], issues: [] });
    expect(() => parseAnalyzerJson('{"files":[')).toThrow('Truncated');
  });
  it('normalizes edges, clone locations, unused files, exports and dependencies separately', () => {
    const value = snapshot();
    expect(value.edges).toEqual([{ from: 'src/a.ts', to: 'src/b.ts', circular: true }]);
    expect(value.issues.map((i) => i.kind)).toEqual(['duplicate', 'unused-file', 'unused-export', 'unused-dependency']);
    expect(value.issues[0]?.locations[1]).toEqual({ path: 'src/b.ts', startLine: 5, endLine: 10 });
    expect(value.issues[0]?.snippet).toBe('return input + 1;');
  });
  it('retains clone identity when code shifts lines', () => {
    const shifted = structuredClone(duplicates); shifted.duplicates[0]!.firstFile.start = 80;
    expect(normalizeAnalysis(dependency, shifted, unused).issues[0]?.id).toBe(snapshot().issues[0]?.id);
  });
  it('measures resolved and unchanged findings rather than assuming every missing result is fixed', () => {
    const baseline = snapshot(); const current = snapshot(); current.issues = current.issues.slice(1);
    expect(compareAnalysis(current, baseline)).toMatchObject({ comparable: true, resolved: [baseline.issues[0]], unchanged: current.issues });
    current.tools[1]!.status = 'failed';
    expect(compareAnalysis(current, baseline)).toMatchObject({ comparable: false, resolved: [] });
    expect(compareAnalysis(current)).toMatchObject({ comparable: false, resolved: [] });
  });
  it('runs pinned analyzers and preserves failures instead of inventing empty clean reports', async () => {
    const run = vi.fn(async (command: string) => ({ ok: true, exitCode: command.includes('knip') ? 1 : 0,
      stdout: command.includes('depcruise') ? JSON.stringify(dependency) : command.includes('knip') ? JSON.stringify(unused) : '' }));
    const result = await analyzeCodebaseTool.execute({}, { caps: { shell: { run }, repoRead: { readFile: async () => ({ ok: true, content: JSON.stringify(duplicates) }) } } } as never);
    expect((result.data.snapshot as CodeAnalysisSnapshot).issues).toHaveLength(4);
    expect(run.mock.calls.some(([command]) => command.includes('typescript@5.6.3'))).toBe(true);
    run.mockImplementation(async () => { throw new Error('npm unavailable'); });
    const failed = await analyzeCodebaseTool.execute({}, { caps: { shell: { run } } } as never);
    expect((failed.data.snapshot as CodeAnalysisSnapshot).tools.every((t) => t.status === 'failed')).toBe(true);
  });
  it('rejects command injection and path traversal in analysis scope', async () => {
    const run = vi.fn();
    for (const path of ['../private', '/private', 'src;whoami', '$(whoami)']) {
      const value = await analyzeCodebaseTool.execute({ path }, { caps: { shell: { run } } } as never);
      expect(value.data.error).toBeTruthy();
    }
    expect(run).not.toHaveBeenCalled();
  });
  it('uploads the complete cloud artifact before returning a bounded model summary', async () => {
    const persist = vi.fn(async (_snapshot: CodeAnalysisSnapshot) => undefined);
    const summary = await runCodeAnalysis({}, {
      run: async (command) => ({ ok: true, exitCode: 0, stdout: command.includes('depcruise') ? JSON.stringify(dependency) : command.includes('knip') ? JSON.stringify(unused) : '' }),
      read: async () => ({ ok: true, content: JSON.stringify(duplicates) }), persist,
    });
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ nodes: ['src/a.ts', 'src/b.ts'], issues: expect.arrayContaining([expect.objectContaining({ kind: 'duplicate' })]) }));
    expect(summary).toMatchObject({ artifactSaved: true, files: 2, findings: 4 });
    expect(summary).not.toHaveProperty('snapshot');
  });
});

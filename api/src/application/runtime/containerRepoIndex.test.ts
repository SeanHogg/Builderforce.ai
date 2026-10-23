/**
 * The container's C5 repo index (`container/repoIndex.mjs`): the `repo.semantic`
 * capability over bf-context, driven with a scripted process runner (no binary needed).
 */
import { describe, expect, it } from 'vitest';
import { startRepoIndex, type ExecFile, type ExecResult } from '../../../container/repoIndex.mjs';

const ok = (stdout = ''): ExecResult => ({ exitCode: 0, stdout, stderr: '', timedOut: false });

/** A runner whose `index` call resolves only when `finishIndex` is called. */
function scriptedExec(answers: (args: string[]) => ExecResult) {
  const calls: string[][] = [];
  let finishIndex: (r: ExecResult) => void = () => {};
  const exec: ExecFile = async (_file, args) => {
    calls.push(args);
    if (args[0] === 'index') return new Promise<ExecResult>((resolve) => { finishIndex = resolve; });
    return answers(args);
  };
  return { exec, calls, finishIndex: (r: ExecResult) => finishIndex(r) };
}

describe('startRepoIndex', () => {
  it('answers "still building" until the background index finishes, then serves the map', async () => {
    const s = scriptedExec(() => ok('src/a.ts\n  1: export function a()\n'));
    const index = await startRepoIndex({ workdir: '/w', bin: 'bf', exec: s.exec });
    const early = await index.repoMap({ maxTokens: 500 });
    expect(early).toMatchObject({ ok: false, indexing: true });
    expect(early.error).toContain('still building');
    s.finishIndex(ok());
    await index.whenSettled();
    const map = await index.repoMap({ maxTokens: 500, focus: ['src/'], query: 'fix --evil the store' });
    expect(map).toEqual({ ok: true, map: 'src/a.ts\n  1: export function a()\n' });
    // argv, never a shell string — and a `--` word cannot end the value list early.
    expect(s.calls[1]).toEqual(['repo-map', '--root', '/w', '--max-tokens', '500', '--focus', 'src/', '--query', 'fix', 'the', 'store']);
    await index.dispose();
  });

  it('maps bf-context search hits to the shared shape, scoped and limited', async () => {
    const hits = {
      results: [
        { path: 'api/a.ts', startLine: 3, endLine: 9, symbol: 'resolveMembership', kind: 'function', snippet: 'fn', score: 1, source: 'keyword' },
        { path: 'web/b.ts', startLine: 1, endLine: 2, symbol: null, kind: 'file', snippet: 'x', score: 0.5, source: 'keyword' },
      ],
    };
    const s = scriptedExec(() => ok(JSON.stringify(hits)));
    const index = await startRepoIndex({ workdir: '/w', bin: 'bf', exec: s.exec });
    s.finishIndex(ok());
    await index.whenSettled();
    const r = await index.search('membership', { scope: 'api', limit: 5 });
    expect(r.ok).toBe(true);
    expect(r.results).toEqual([{ path: 'api/a.ts', startLine: 3, endLine: 9, symbol: 'resolveMembership', kind: 'function', snippet: 'fn', source: 'keyword' }]);
    expect(s.calls[1]).toEqual(['search', '/w', 'membership']);
    await index.dispose();
  });

  it('reports a failed index honestly instead of an empty map', async () => {
    const s = scriptedExec(() => ok());
    const index = await startRepoIndex({ workdir: '/w', bin: 'bf', exec: s.exec });
    s.finishIndex({ exitCode: 1, stdout: '', stderr: 'boom', timedOut: false });
    await index.whenSettled();
    expect(index.state).toBe('failed');
    expect(await index.repoMap({})).toMatchObject({ ok: false, error: expect.stringContaining('boom') });
    await index.dispose();
  });
});

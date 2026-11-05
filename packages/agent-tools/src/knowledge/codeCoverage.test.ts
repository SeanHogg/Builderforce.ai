import { describe, expect, it } from 'vitest';
import { coveragePathOf, coverageSourceState, parseIstanbul, parseLcov, readCoverage } from './codeCoverage.js';
import { memoryKnowledgeFs } from './memoryKnowledgeFs.test-util.js';

const istanbul = JSON.stringify({
  '/repo/src/a.ts': { path: '/repo/src/a.ts', statementMap: { 0: { start: { line: 1 } }, 1: { start: { line: 2 } }, 2: { start: { line: 2 } } }, s: { 0: 1, 1: 0, 2: 3 } },
  '/other/x.ts': { path: '/other/x.ts', statementMap: { 0: { start: { line: 1 } } }, s: { 0: 1 } },
});
const lcov = 'SF:src/b.ts\nDA:1,1\nDA:2,1\nDA:3,0\nDA:4,0\nend_of_record\nSF:/repo/packages/p/src/c.ts\nLF:4\nLH:3\nend_of_record\n';

describe('coverage parsing', () => {
  it('maps absolute and package-relative paths to root-relative ones, dropping what lies outside', () => {
    expect(coveragePathOf('/repo/src/a.ts', '/repo', '')).toBe('src/a.ts');
    expect(coveragePathOf('C:\\repo\\src\\a.ts', 'c:/repo', '')).toBe('src/a.ts');
    expect(coveragePathOf('src/b.ts', '/repo', 'packages/p')).toBe('packages/p/src/b.ts');
    expect(coveragePathOf('../shared/z.ts', '/repo', 'packages/p')).toBe('packages/shared/z.ts');
    expect(coveragePathOf('/other/x.ts', '/repo', '')).toBeUndefined();
    // A POSIX root is case-sensitive; a Windows root is not.
    expect(coveragePathOf('/Repo/src/a.ts', '/repo', '')).toBeUndefined();
    expect(coveragePathOf('c:/Repo/src/a.ts', 'C:/repo', '')).toBe('src/a.ts');
    expect(coveragePathOf('../../../x.ts', '/repo', 'a')).toBeUndefined();
  });

  it('istanbul: a line is covered when any statement starting on it ran', () => {
    // line 1 ran, line 2 has two statements and one ran -> 2 of 2 lines
    expect([...parseIstanbul(istanbul, '/repo', '')]).toEqual([['src/a.ts', 1]]);
    const half = JSON.stringify({ '/repo/a.ts': { statementMap: { 0: { start: { line: 1 } }, 1: { start: { line: 2 } } }, s: { 0: 1, 1: 0 } } });
    expect(parseIstanbul(half, '/repo', '').get('a.ts')).toBe(0.5);
    expect(parseIstanbul('{nope', '/repo', '').size).toBe(0);
  });

  it('lcov: DA lines, else LH / LF', () => {
    expect([...parseLcov(lcov, '/repo', 'packages/p')]).toEqual([['packages/p/src/b.ts', 0.5], ['packages/p/src/c.ts', 0.75]]);
  });
});

describe('readCoverage / coverageSourceState', () => {
  it('finds root and per-package coverage folders and skips install trees', async () => {
    const fs = memoryKnowledgeFs({
      '/repo/coverage/coverage-final.json': istanbul,
      '/repo/packages/p/coverage/lcov.info': lcov,
      '/repo/node_modules/x/coverage/lcov.info': 'SF:a.ts\nDA:1,1\nend_of_record\n',
    });
    const got = (await readCoverage({ fs, rootPath: '/repo' })).values;
    expect([...got].sort()).toEqual([['packages/p/src/b.ts', 0.5], ['packages/p/src/c.ts', 0.75], ['src/a.ts', 1]]);
    expect(await coverageSourceState({ fs, rootPath: '/repo' })).toBe('collected');
  });

  it('leaves out a file edited after its coverage was written, and says why', async () => {
    const fs = memoryKnowledgeFs({
      '/repo/coverage/coverage-final.json': { text: istanbul, mtime: 100 },
      '/repo/src/a.ts': { text: 'x', mtime: 200 },
    });
    const report = await readCoverage({ fs, rootPath: '/repo' });
    expect(report.values.size).toBe(0);
    expect(report.skipped).toEqual([{ path: 'src/a.ts', reason: 'stale' }]);
    const fresh = memoryKnowledgeFs({
      '/repo/coverage/coverage-final.json': { text: istanbul, mtime: 300 },
      '/repo/src/a.ts': { text: 'x', mtime: 200 },
    });
    expect([...(await readCoverage({ fs: fresh, rootPath: '/repo' })).values]).toEqual([['src/a.ts', 1]]);
  });

  it('does not read a coverage file over the size cap, and reports it', async () => {
    const fs = memoryKnowledgeFs({ '/repo/coverage/lcov.info': { text: lcov, size: 50 * 1024 * 1024 } });
    const report = await readCoverage({ fs, rootPath: '/repo' });
    expect(report.values.size).toBe(0);
    expect(report.skipped).toEqual([{ path: 'coverage/lcov.info', reason: 'too-large' }]);
  });

  it('is absent when no coverage file exists (no badge, no invention)', async () => {
    const fs = memoryKnowledgeFs({ '/repo/src/a.ts': 'x' });
    expect((await readCoverage({ fs, rootPath: '/repo' })).values.size).toBe(0);
    expect(await coverageSourceState({ fs, rootPath: '/repo' })).toBe('absent');
  });
});

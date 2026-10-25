import { describe, expect, it } from 'vitest';
import { ReadCoverage } from '../readCoverage';
import { recordShellFileRead } from './shellReadCoverage';

/**
 * PRD 35 E1 × E3: a `cat` print is the `read_file` of the file it printed — in the
 * directory the command actually RAN in. With a default checkout set, `run_command`
 * runs there (`cd "app" && cat src/a.ts`) and reports `cwd: "app"`, so the read is of
 * `app/src/a.ts`, not of a root-level `src/a.ts` the model never saw.
 */
describe('recordShellFileRead — the effective cwd', () => {
  const print = { ok: true, exitCode: 0, stdout: 'one\ntwo\nthree' };

  it('uses the cwd the shell result reports (the default checkout)', () => {
    const cov = new ReadCoverage();
    expect(recordShellFileRead(cov, 'run_command', { command: 'cat src/a.ts' }, { ...print, cwd: 'app' }, true, null)).toBe(true);
    expect(cov.isRepeat('read_file', { path: 'app/src/a.ts' })).toBe(true);
    expect(cov.isRepeat('read_file', { path: 'src/a.ts' })).toBe(false);
  });

  it('falls back to the cwd argument when the result carries none', () => {
    const cov = new ReadCoverage();
    expect(recordShellFileRead(cov, 'run_command', { command: 'cat src/a.ts', cwd: 'api' }, print, true, null)).toBe(true);
    expect(cov.isRepeat('read_file', { path: 'api/src/a.ts' })).toBe(true);
  });

  it('the reported cwd wins over the argument it was resolved from', () => {
    const cov = new ReadCoverage();
    recordShellFileRead(cov, 'run_command', { command: 'cat a.ts', cwd: './web/' }, { ...print, cwd: 'web' }, true, null);
    expect(cov.isRepeat('read_file', { path: 'web/a.ts' })).toBe(true);
  });

  it('a print the transcript cut is not recorded', () => {
    const cov = new ReadCoverage();
    expect(recordShellFileRead(cov, 'run_command', { command: 'cat a.ts' }, { ...print, cwd: 'app' }, false, null)).toBe(false);
  });
});

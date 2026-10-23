/** D7, the container half (`container/postEditChecks.mjs`): plan, debounce, failures only. */
import { describe, expect, it, vi } from 'vitest';
import { createPostEditChecks, planPostEditChecks, type PostEditCheckIo } from '../../../container/postEditChecks.mjs';

/** A fake clone: `files` exist, `bins` are on PATH, `scripts` per package directory. */
function io(files: string[], bins: string[] = [], scripts: Record<string, Record<string, string>> = {}): PostEditCheckIo {
  return {
    exists: async (rel) => files.includes(rel),
    hasBin: async (name) => bins.includes(name),
    readScripts: async (dir) => scripts[dir] ?? null,
  };
}

describe('planPostEditChecks', () => {
  it('runs the nearest package\'s fast script, once per package', async () => {
    const plans = await planPostEditChecks(
      ['packages/a/src/x.ts', 'packages/a/src/y.ts', 'packages/b/z.ts'],
      io(['packages/a/package.json', 'packages/a/node_modules', 'packages/b/package.json', 'packages/b/node_modules'], [], {
        'packages/a': { typecheck: 'tsc', test: 'vitest' },
        'packages/b': { lint: 'eslint .', build: 'tsc' },
      }),
    );
    expect(plans.map((p) => [p.cwd, p.command])).toEqual([
      ['packages/a', 'npm run --silent typecheck'],
      ['packages/b', 'npm run --silent lint'],
    ]);
  });

  it('falls back to tsc when no fast script is declared, and skips when deps are not installed', async () => {
    const withTsc = await planPostEditChecks(['src/a.ts'], io(['package.json', 'node_modules', 'tsconfig.json', 'node_modules/.bin/tsc'], [], { '': { build: 'x' } }));
    expect(withTsc.map((p) => p.command)).toEqual(['npx --no-install tsc --noEmit -p tsconfig.json']);
    expect(await planPostEditChecks(['src/a.ts'], io(['package.json', 'tsconfig.json'], [], { '': { typecheck: 'tsc' } }))).toEqual([]);
  });

  it('checks Rust with cargo and Python with py_compile only when the tool exists', async () => {
    const plans = await planPostEditChecks(['crates/x/src/lib.rs', 'tools/a.py', "tools/it's.py"], io(['crates/x/Cargo.toml'], ['cargo', 'python3']));
    expect(plans.map((p) => [p.row.id, p.cwd, p.command])).toEqual([
      ['cargo-check', 'crates/x', 'cargo check --quiet --message-format short'],
      ['py-compile', '', `python3 -m py_compile 'tools/a.py' 'tools/it'\\''s.py'`],
    ]);
    expect(await planPostEditChecks(['a.py', 'x.md'], io([]))).toEqual([]);
  });
});

describe('createPostEditChecks', () => {
  const clone = io(['package.json', 'node_modules'], [], { '': { typecheck: 'tsc --noEmit' } });

  it('debounces a turn\'s edits into one run and reports only failures, summarized', async () => {
    const run = vi.fn(async () => ({ exitCode: 2, output: 'src/a.ts(3,1): error TS2304: x' }));
    const checks = createPostEditChecks({ workdir: '/w', run, io: clone, fit: (o) => `<<${o}>>` });
    checks.touch('src/a.ts');
    checks.touch('src/b.ts');
    const msg = await checks.drain();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('npm run --silent typecheck', '/w', expect.any(Number));
    expect(msg).toContain('[post-edit checks]');
    expect(msg).toContain('<<src/a.ts(3,1): error TS2304: x>>');
    // Nothing touched since ⇒ nothing runs.
    expect(await checks.drain()).toBeNull();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('says nothing when the checks pass or time out', async () => {
    for (const result of [{ exitCode: 0, output: 'ok' }, { exitCode: -1, output: '', timedOut: true }]) {
      const checks = createPostEditChecks({ workdir: '/w', run: async () => result, io: clone, fit: (o) => o });
      checks.touch('src/a.ts');
      expect(await checks.drain()).toBeNull();
    }
  });

  it('reports the batch as a verifier verdict for the cascade (D1): failed with the commands, passed, or none when nothing judged', async () => {
    const failing = createPostEditChecks({ workdir: '/w', run: async () => ({ exitCode: 2, output: 'boom' }), io: clone, fit: (o) => o });
    failing.touch('src/a.ts');
    const failed = await failing.drainVerdict();
    expect(failed).toMatchObject({ passed: false, verifier: 'post_edit_checks', reason: '`npm run --silent typecheck` exit 2' });
    expect(failed?.steer).toContain('[post-edit checks]');
    expect(await failing.drainVerdict()).toBeNull();

    const passing = createPostEditChecks({ workdir: '/w', run: async () => ({ exitCode: 0, output: 'ok' }), io: clone, fit: (o) => o });
    passing.touch('src/a.ts');
    expect(await passing.drainVerdict()).toEqual({ passed: true, verifier: 'post_edit_checks', steer: null });

    const timedOut = createPostEditChecks({ workdir: '/w', run: async () => ({ exitCode: -1, output: '', timedOut: true }), io: clone, fit: (o) => o });
    timedOut.touch('src/a.ts');
    expect(await timedOut.drainVerdict()).toBeNull();
  });

  it('stays within its time budget', async () => {
    const run = vi.fn(async () => ({ exitCode: 1, output: 'x' }));
    const checks = createPostEditChecks({ workdir: '/w', run, io: clone, fit: (o) => o, budgetMs: 500 });
    checks.touch('src/a.ts');
    expect(await checks.drain()).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { runBuildGate, type BuildGatePorts } from './buildGate';

const FILES = { 'package.json': '{}', 'index.html': '<div id="root"></div>', 'src/App.tsx': 'export const x = 1;', 'src/old.ts': '' };

function ports(overrides: Partial<BuildGatePorts> = {}): BuildGatePorts {
  return {
    readTree: async () => ({ kind: 'files', files: FILES }),
    hasTypeScript: () => true,
    typecheck: async () => ({ errors: [], lines: [] }),
    buildPort: async () => async () => [],
    ...overrides,
  };
}

const typeError = (file: string) => ({ file, line: 1, column: 1, code: 2322, category: 'error' as const, message: 'bad' });

describe('runBuildGate', () => {
  it('passes a change that type-checks and builds', async () => {
    const result = await runBuildGate(['src/App.tsx'], ports());
    expect(result).toMatchObject({ ok: true });
    expect(result.skipped).toBeUndefined();
  });

  it('fails on a type error in a file the agent wrote, with the diagnostics', async () => {
    const result = await runBuildGate(['./src/App.tsx'], ports({
      typecheck: async () => ({ errors: [typeError('src/App.tsx')], lines: ['src/App.tsx(1,1): error TS2322: bad'] }),
    }));
    expect(result.ok).toBe(false);
    expect(result.output).toContain('error TS2322');
  });

  it('ignores type errors the repo already had in files the agent did not touch', async () => {
    const result = await runBuildGate(['src/App.tsx'], ports({
      typecheck: async () => ({ errors: [typeError('src/old.ts')], lines: ['src/old.ts(1,1): error TS2322: bad'] }),
    }));
    expect(result.ok).toBe(true);
  });

  it('fails when the build fails', async () => {
    const result = await runBuildGate(['src/App.tsx'], ports({
      buildPort: async () => async () => { throw new Error('Could not resolve "./Missing"'); },
    }));
    expect(result).toMatchObject({ ok: false });
    expect(result.output).toContain('Could not resolve');
  });

  it('skips — never fails — a project the runtime cannot build, without type-checking it', async () => {
    const typecheck = vi.fn(async () => ({ errors: [], lines: [] }));
    const result = await runBuildGate(['app/page.tsx'], ports({ buildPort: async () => ({ skip: 'Next.js needs its Node server.' }), typecheck }));
    expect(result).toEqual({ ok: true, skipped: true, output: 'Build gate skipped: Next.js needs its Node server.' });
    expect(typecheck).not.toHaveBeenCalled();
  });

  it('skips a repository too large to build in a tab', async () => {
    const result = await runBuildGate(['a.ts'], ports({ readTree: async () => ({ kind: 'too-large', reason: 'too big' }) }));
    expect(result).toMatchObject({ ok: true, skipped: true });
  });
});

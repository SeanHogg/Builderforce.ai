import { describe, expect, it, vi } from 'vitest';
import { runProjectChecks, type CheckPorts } from './projectChecks';

function ports(overrides: Partial<CheckPorts> = {}): CheckPorts {
  return {
    typecheck: async () => ({ errors: [], lines: [] }),
    build: async () => [],
    lint: null,
    onStep: vi.fn(),
    onOutput: vi.fn(),
    ...overrides,
  };
}

describe('runProjectChecks', () => {
  it('passes a clean project and skips what it does not have', async () => {
    const { results, failures } = await runProjectChecks(ports({ typecheck: null }));
    expect(results).toEqual([
      { label: 'type-check', status: 'skip', detail: 'no TypeScript' },
      { label: 'build', status: 'pass' },
      { label: 'lint', status: 'skip', detail: 'no script' },
    ]);
    expect(failures).toEqual([]);
  });

  it('fails the type-check on errors only, and hands the agent the diagnostics', async () => {
    const line = "src/App.tsx(3,7): error TS2322: Type 'string' is not assignable to type 'number'.";
    const onOutput = vi.fn();
    const { results, failures } = await runProjectChecks(ports({
      typecheck: async () => ({ errors: [{ file: 'src/App.tsx', line: 3, column: 7, message: 'x', code: 2322, category: 'error' }], lines: [line] }),
      onOutput,
    }));
    expect(results[0]).toEqual({ label: 'type-check', status: 'fail', detail: '1 error' });
    expect(failures[0]).toMatchObject({ command: 'tsc --noEmit', detail: line });
    expect(onOutput).toHaveBeenCalledWith(`${line}\r\n`);
  });

  it('keeps checking after a failed build, and reports the bundler error', async () => {
    const { results, failures } = await runProjectChecks(ports({
      build: async () => { throw new Error('Could not resolve "./Missing"\nat src/main.tsx'); },
      lint: async () => ({ step: 'lint', code: 0, output: '' }),
    }));
    expect(results.map((r) => [r.label, r.status])).toEqual([['type-check', 'pass'], ['build', 'fail'], ['lint', 'pass']]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ command: 'npm run build', message: 'build failed: Could not resolve "./Missing"' });
  });

  it('names the install, not lint, when installing for lint fails', async () => {
    const { results, failures } = await runProjectChecks(ports({
      lint: async () => ({ step: 'npm install', code: 1, output: 'ETARGET' }),
    }));
    expect(results[2]).toEqual({ label: 'npm install', status: 'fail', detail: 'exit 1' });
    expect(failures[0]).toMatchObject({ command: 'npm install', exitCode: 1, detail: 'ETARGET' });
  });
});

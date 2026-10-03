/**
 * The workspace's Check: type-check, build and lint a project in the browser,
 * and say which passed.
 *
 * Type-check and build need no install — they run on the files themselves
 * (`siteTools.ts`). Only lint runs the project's own `npm run lint`, on the Node
 * runtime, because ESLint is the project's choice of config and plugins. Each
 * step is a port, so the order and the pass/fail rules are tested without a
 * browser.
 */
import type { BuildFailureInput } from '@/lib/buildDiagnostics';
import type { TypecheckOutcome } from './siteTools';

export interface CheckResult {
  /** The step (`type-check`, `build`, `lint`, `npm install`) — an identifier, shown verbatim. */
  label: string;
  status: 'pass' | 'fail' | 'skip';
  detail?: string;
}

export interface CheckPorts {
  /** Null when there is no TypeScript to check. */
  typecheck: (() => Promise<TypecheckOutcome>) | null;
  build: () => Promise<unknown>;
  /** Null when the project defines no `lint` script. Install first, then run it; reports the step that failed. */
  lint: (() => Promise<{ step: 'npm install' | 'lint'; code: number; output: string }>) | null;
  /** A step is starting (the terminal prints a section header). */
  onStep: (label: string) => void;
  /** Output to show the person watching. */
  onOutput: (text: string) => void;
}

export interface ChecksOutcome {
  results: CheckResult[];
  /** What the agent should be told about, one per failed step. */
  failures: BuildFailureInput[];
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function runProjectChecks(ports: CheckPorts): Promise<ChecksOutcome> {
  const results: CheckResult[] = [];
  const failures: BuildFailureInput[] = [];

  if (!ports.typecheck) {
    results.push({ label: 'type-check', status: 'skip', detail: 'no TypeScript' });
  } else {
    ports.onStep('type-check');
    const outcome = await ports.typecheck();
    if (outcome.lines.length) ports.onOutput(`${outcome.lines.join('\r\n')}\r\n`);
    const count = outcome.errors.length;
    results.push(count ? { label: 'type-check', status: 'fail', detail: `${count} error${count === 1 ? '' : 's'}` } : { label: 'type-check', status: 'pass' });
    if (count) {
      failures.push({ source: 'build', command: 'tsc --noEmit', message: `type-check failed (${count} error${count === 1 ? '' : 's'}).`, detail: outcome.lines.join('\n') });
    }
  }

  ports.onStep('build');
  try {
    await ports.build();
    results.push({ label: 'build', status: 'pass' });
  } catch (error) {
    const message = errorText(error);
    ports.onOutput(`${message.replace(/\n/g, '\r\n')}\r\n`);
    results.push({ label: 'build', status: 'fail', detail: message.split('\n')[0] });
    failures.push({ source: 'build', command: 'npm run build', message: `build failed: ${message.split('\n')[0]}`, detail: message });
  }

  if (!ports.lint) {
    results.push({ label: 'lint', status: 'skip', detail: 'no script' });
  } else {
    ports.onStep('lint');
    const { step, code, output } = await ports.lint();
    const label = step === 'npm install' ? 'npm install' : 'lint';
    results.push(code === 0 ? { label, status: 'pass' } : { label, status: 'fail', detail: `exit ${code}` });
    if (code !== 0) {
      const command = step === 'npm install' ? 'npm install' : 'npm run lint';
      failures.push({ source: 'build', command, exitCode: code, message: `${command} failed (exit ${code}).`, detail: output });
    }
  }

  return { results, failures };
}

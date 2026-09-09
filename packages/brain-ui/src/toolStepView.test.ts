import { describe, it, expect } from 'vitest';
import { commandOf, shellOutcomeOf, toolPreview, toolStepView } from './toolStepView';

/**
 * The contract these hold: a shell step shows the COMMAND and what it PRINTED, and
 * nothing the raw JSON carried is ever dropped on the way there.
 */
describe('commandOf', () => {
  it('reads the command line off a shell call', () => {
    expect(commandOf({ command: 'pnpm -w test' })).toBe('pnpm -w test');
    expect(commandOf({ cmd: ' git status ' })).toBe('git status');
  });

  it('is null for a call that runs no command', () => {
    expect(commandOf({ path: 'src/index.ts' })).toBeNull();
    expect(commandOf({ command: '   ' })).toBeNull();
    expect(commandOf(null)).toBeNull();
    expect(commandOf('git status')).toBeNull();
    expect(commandOf(['git', 'status'])).toBeNull();
  });
});

describe('shellOutcomeOf', () => {
  it('renders stdout as terminal text, not JSON', () => {
    const out = shellOutcomeOf({ ok: true, exitCode: 0, stdout: 'ok\n2 passed\n\n' });
    expect(out.output).toBe('ok\n2 passed');
    expect(out.exitCode).toBe(0);
    expect(out.ok).toBe(true);
    // Every field is one the terminal panel shows, so the raw JSON adds nothing.
    expect(out.outputComplete).toBe(true);
  });

  it('joins stdout, stderr and error in the order a terminal printed them', () => {
    const out = shellOutcomeOf({ ok: false, exitCode: 1, stdout: 'building', stderr: 'boom', error: 'exit 1' });
    expect(out.output).toBe('building\nboom\nexit 1');
    expect(out.ok).toBe(false);
    expect(out.exitCode).toBe(1);
  });

  it('infers ok from the exit code when the result does not state it', () => {
    expect(shellOutcomeOf({ exitCode: 0, stdout: 'x' }).ok).toBe(true);
    expect(shellOutcomeOf({ exitCode: 2, stdout: 'x' }).ok).toBe(false);
    expect(shellOutcomeOf({ stdout: 'x' }).ok).toBe(true);
  });

  it('parses a result a host handed back as a JSON string', () => {
    const out = shellOutcomeOf(JSON.stringify({ ok: true, exitCode: 0, stdout: 'hi' }));
    expect(out.output).toBe('hi');
    expect(out.exitCode).toBe(0);
  });

  it('takes a bare string result as the output verbatim', () => {
    const out = shellOutcomeOf('two files changed\n');
    expect(out.output).toBe('two files changed');
    expect(out.outputComplete).toBe(true);
  });

  it('keeps the raw JSON when the result carries a field the terminal does not show', () => {
    // Dropping the JSON here would hide `files` — the panel must stay.
    expect(shellOutcomeOf({ ok: true, stdout: 'done', files: ['a.ts'] }).outputComplete).toBe(false);
  });

  it('treats a missing result as an empty, complete outcome', () => {
    expect(shellOutcomeOf(null)).toEqual({ output: '', exitCode: null, ok: true, outputComplete: true });
  });
});

describe('toolPreview', () => {
  it('reads an edit as a before/after pair and a write as its content', () => {
    expect(toolPreview({ path: 'a.ts', old_string: 'a', new_string: 'b' }))
      .toEqual({ kind: 'edit', path: 'a.ts', oldText: 'a', newText: 'b' });
    expect(toolPreview({ path: 'a.ts', content: 'hello' }))
      .toEqual({ kind: 'write', path: 'a.ts', content: 'hello' });
    expect(toolPreview({ query: 'x' })).toBeNull();
  });
});

describe('toolStepView', () => {
  it('presents a shell step as a command card and drops the JSON it duplicates', () => {
    const view = toolStepView({
      args: { command: 'pnpm -w test' },
      result: { ok: true, exitCode: 0, stdout: '2 passed' },
      isError: false,
    });
    expect(view.command).toEqual({
      command: 'pnpm -w test',
      output: '2 passed',
      exitCode: 0,
      ok: true,
      outputComplete: true,
    });
    // The command line IS the input, and the terminal panel IS the output.
    expect(view.argsText).toBe('');
    expect(view.resultText).toBe('');
    expect(view.subject).toBe('pnpm -w test');
    // A command is what a reader opens the transcript to check.
    expect(view.defaultOpen).toBe(true);
  });

  it('still shows arguments the command line does not account for', () => {
    const view = toolStepView({
      args: { command: 'pnpm build', cwd: 'frontend' },
      result: { ok: true, stdout: 'built' },
      isError: false,
    });
    expect(view.argsText).toBe(JSON.stringify({ cwd: 'frontend' }, null, 2));
  });

  it('keeps the raw result when it carries more than the terminal shows', () => {
    const view = toolStepView({
      args: { command: 'ls' },
      result: { ok: true, stdout: 'a.ts', files: ['a.ts'] },
      isError: false,
    });
    expect(view.resultText).toContain('"files"');
  });

  it('leaves a non-shell step exactly as it was: raw input and output, folded away', () => {
    const view = toolStepView({ args: { path: 'src/a.ts' }, result: { ok: true, content: 'x' }, isError: false });
    expect(view.command).toBeNull();
    expect(view.argsText).toBe(JSON.stringify({ path: 'src/a.ts' }, null, 2));
    expect(view.resultText).toBe(JSON.stringify({ ok: true, content: 'x' }, null, 2));
    expect(view.subject).toBe('src/a.ts');
    expect(view.defaultOpen).toBe(false);
  });

  it('opens a failed step — the one nobody should have to click to read', () => {
    expect(toolStepView({ args: { path: 'a.ts' }, result: { ok: false }, isError: true }).defaultOpen).toBe(true);
  });
});

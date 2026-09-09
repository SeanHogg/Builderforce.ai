import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToolStep, type ToolStepLabels, type ToolStepNode } from './ToolStep';
import { DEFAULT_TIMELINE_LABELS } from './BrainTimeline';

const labels: ToolStepLabels = DEFAULT_TIMELINE_LABELS;

const render = (node: ToolStepNode) => renderToStaticMarkup(<ToolStep node={node} labels={labels} />);

describe('<ToolStep> shell steps', () => {
  it('shows the command and its terminal output, open, without JSON around either', () => {
    const html = render({
      label: 'run_command',
      args: { command: 'pnpm -w test' },
      result: { ok: true, exitCode: 0, stdout: '2 passed' },
      isError: false,
      durationMs: 4200,
    });
    // Open by default — the answer to "did it really run the tests" is not behind a caret.
    expect(html).toContain('<details class="bf-tl__tool" open');
    expect(html).toContain('bf-tl__cmd-in');
    expect(html).toContain('pnpm -w test');
    expect(html).toContain('2 passed');
    // The command IS the input and the terminal text IS the output: neither is
    // repeated as a raw JSON panel underneath.
    expect(html).not.toContain('&quot;stdout&quot;');
    expect(html).not.toContain('&quot;command&quot;');
    // And the header names what ran, so the step reads without opening it.
    expect(html).toContain('bf-tl__tool-subject');
  });

  it('calls out a non-zero exit code and marks the output as failed', () => {
    const html = render({
      label: 'run_command',
      args: { command: 'pnpm build' },
      result: { ok: false, exitCode: 1, stdout: 'error TS2304' },
      isError: true,
    });
    expect(html).toContain('Exit 1');
    expect(html).toContain('bf-tl__cmd-out--error');
  });

  it('says so when a command printed nothing, rather than leaving an empty frame', () => {
    const html = render({ label: 'run_command', args: { command: 'true' }, result: { ok: true, exitCode: 0 }, isError: false });
    expect(html).toContain('No output');
    expect(html).not.toContain('bf-tl__cmd-out');
  });

  it('keeps arguments the command line does not account for', () => {
    const html = render({
      label: 'run_command',
      args: { command: 'pnpm build', cwd: 'frontend' },
      result: { ok: true, stdout: 'built' },
      isError: false,
    });
    expect(html).toContain('cwd');
    expect(html).toContain('frontend');
  });
});

describe('<ToolStep> other steps', () => {
  it('leaves a plain lookup collapsed with its raw input and output', () => {
    const html = render({ label: 'read_file', args: { path: 'a.ts' }, result: { ok: true }, isError: false });
    expect(html).toContain('<details class="bf-tl__tool"');
    expect(html).not.toContain('open=""');
    expect(html).not.toContain('bf-tl__cmd-in');
    expect(html).toContain('&quot;path&quot;');
  });

  it('renders an edit as a before/after diff', () => {
    const html = render({
      label: 'edit_file',
      args: { path: 'a.ts', old_string: 'one', new_string: 'two' },
      result: { ok: true },
      isError: false,
    });
    expect(html).toContain('bf-tl__diff-del');
    expect(html).toContain('bf-tl__diff-add');
  });
});

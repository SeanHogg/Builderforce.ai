import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BrainTimeline, DEFAULT_TIMELINE_LABELS } from '../BrainTimeline';
import type { BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
import { groupToolNodes, toolGroupSummary, type ToolNode } from './toolGroups';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tool = (key: string, args: unknown = {}, label = 'memory_recall'): ToolNode => ({
  kind: 'tool', key, ts: 1, order: 1, label, args, result: 'complete', isError: false,
});

describe('tool groups', () => {
  it('groups adjacent calls, including single calls, without crossing narration', () => {
    const a = tool('a');
    const b = tool('b');
    const boundary = { kind: 'thinking' as const, key: 'thought', ts: 2, order: 2, step: 1 };
    expect(groupToolNodes([a, b, boundary, a])).toEqual([
      { kind: 'toolGroup', key: 'tools:a', tools: [a, b] }, boundary,
      { kind: 'toolGroup', key: 'tools:a', tools: [a] },
    ]);
  });

  it('summarizes command-shaped calls and names other tools once', () => {
    expect(toolGroupSummary([
      tool('a'), tool('b'), tool('c', { cmd: 'pnpm test' }, 'exec'),
    ], DEFAULT_TIMELINE_LABELS)).toBe('Used memory_recall (2) · Ran commands (1)');
  });


});

let root: Root | undefined;
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; document.body.innerHTML = ''; });

describe('tool group disclosures in the transcript', () => {
  it('starts collapsed, exposes full details, and stays open as calls append', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const trace: BrainTraceEvent[] = [{
      category: 'tool', label: 'run_command', ts: '2026-11-23T12:00:00Z',
      args: { command: 'pnpm test', cwd: '/workspace' }, result: { stdout: 'All passed', exitCode: 0 },
    }];
    const render = (events: BrainTraceEvent[]) => act(() => root!.render(
      <BrainTimeline messages={[]} trace={events} streamingText="" isRunning />,
    ));
    render(trace);
    const group = host.querySelector<HTMLDetailsElement>('.bf-tl__tool-group')!;
    const call = host.querySelector<HTMLDetailsElement>('.bf-tl__tool')!;
    expect(group.open).toBe(false);
    expect(call.open).toBe(false);
    // Native details summary activation works with the mouse and keyboard in the webview.
    act(() => { group.open = true; group.dispatchEvent(new Event('toggle')); });
    await act(async () => { call.open = true; call.dispatchEvent(new Event('toggle')); });
    expect(call.textContent).toContain('All passed');
    expect(call.textContent).toContain('/workspace');
    render([...trace, { ...trace[0]!, ts: '2026-11-23T12:00:01Z', args: { command: 'git status' } }]);
    expect(host.querySelector('.bf-tl__tool-group')).toBe(group);
    expect(group.open).toBe(true);
    expect(call.open).toBe(true);
    expect(group.querySelector('summary')?.textContent).toContain('Ran commands (2)');
    expect(group.querySelectorAll('.bf-tl__tool')).toHaveLength(2);
  });

  it('flags failures in the collapsed summary and opens the failed call within it', () => {
    const host = document.createElement('div');
    root = createRoot(host);
    act(() => root!.render(<BrainTimeline messages={[]} streamingText="" isRunning={false} trace={[{
      category: 'tool', label: 'run_command', ts: '2026-11-23T12:00:00Z',
      args: { command: 'pnpm test' }, result: { error: 'failed' }, isError: true,
    }]} />));
    expect(host.querySelector('.bf-tl__tool-group-failed')?.textContent).toBe('1 failed');
    expect(host.querySelector<HTMLDetailsElement>('.bf-tl__tool-group')?.open).toBe(false);
    expect(host.querySelector<HTMLDetailsElement>('.bf-tl__tool')?.open).toBe(true);
  });
});

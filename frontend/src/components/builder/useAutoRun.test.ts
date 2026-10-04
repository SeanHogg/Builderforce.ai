import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoRun, hasRunnableEntry } from './useAutoRun';
import type { RunPhase } from './useWorkspaceRun';
import type { FileEntry } from '@/lib/types';

/**
 * The preview starts by itself — there is no Run button to fall back on — so the
 * rules for WHEN it starts are the contract: on open, when files change while
 * nothing is live, never while live, and never in a loop over the same input.
 */

const file = (path: string): FileEntry => ({ path, content: '', type: 'file' });
const SITE = [file('package.json'), file('src/App.jsx')];

describe('hasRunnableEntry', () => {
  it('needs a package.json or an index.html', () => {
    expect(hasRunnableEntry([])).toBe(false);
    expect(hasRunnableEntry([file('src/App.jsx')])).toBe(false);
    expect(hasRunnableEntry([file('package.json')])).toBe(true);
    expect(hasRunnableEntry([file('index.html')])).toBe(true);
  });

  it('ignores a directory entry that happens to share the name', () => {
    expect(hasRunnableEntry([{ path: 'index.html', content: '', type: 'directory' } as unknown as FileEntry])).toBe(false);
  });
});

describe('useAutoRun', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const mount = (initial: { enabled?: boolean; files: FileEntry[]; phase: RunPhase }, run = vi.fn(async () => {})) => {
    const hook = renderHook((props: { enabled: boolean; files: FileEntry[]; phase: RunPhase }) => useAutoRun({ ...props, run }), {
      initialProps: { enabled: initial.enabled ?? true, files: initial.files, phase: initial.phase },
    });
    return { ...hook, run };
  };

  it('starts the preview when the workspace opens with something to run', async () => {
    const { run } = mount({ files: SITE, phase: 'idle' });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does nothing for an empty project', async () => {
    const { run } = mount({ files: [], phase: 'idle' });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(run).not.toHaveBeenCalled();
  });

  it('does nothing for a project type without a live preview', async () => {
    const { run } = mount({ enabled: false, files: SITE, phase: 'idle' });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(run).not.toHaveBeenCalled();
  });

  it('never restarts a live preview when files change — hot reload carries the edit', async () => {
    const { run, rerender } = mount({ files: SITE, phase: 'live' });
    rerender({ enabled: true, files: [...SITE, file('src/New.jsx')], phase: 'live' });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(run).not.toHaveBeenCalled();
  });

  it('after a failure, waits for the files to change instead of retrying the same input', async () => {
    const { run, rerender } = mount({ files: SITE, phase: 'idle' });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(run).toHaveBeenCalledTimes(1);

    rerender({ enabled: true, files: SITE, phase: 'failed' });
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(run).toHaveBeenCalledTimes(1);

    // The agent lands a fix: a new file list is new input, so it tries again.
    rerender({ enabled: true, files: [...SITE, file('src/Fix.jsx')], phase: 'failed' });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('lets a burst of writes land as one run', async () => {
    const { run, rerender } = mount({ files: [], phase: 'idle' });
    rerender({ enabled: true, files: [file('package.json')], phase: 'idle' });
    await act(async () => { vi.advanceTimersByTime(200); });
    rerender({ enabled: true, files: SITE, phase: 'idle' });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(run).toHaveBeenCalledTimes(1);
  });
});

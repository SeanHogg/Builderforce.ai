// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { sendWorkspaceCommand, useWorkspaceCommands } from './workspaceCommands';

const settle = () => new Promise<void>((resolve) => { queueMicrotask(resolve); });

describe('workspace commands', () => {
  it('a plain send reaches a mounted workspace and nobody else', () => {
    const mine = vi.fn();
    const theirs = vi.fn();
    const a = renderHook(() => useWorkspaceCommands(101, mine));
    const b = renderHook(() => useWorkspaceCommands(102, theirs));
    sendWorkspaceCommand(101, { type: 'openTab', tab: 'publish' });
    expect(mine).toHaveBeenCalledWith({ type: 'openTab', tab: 'publish' });
    expect(theirs).not.toHaveBeenCalled();
    a.unmount();
    b.unmount();
  });

  it('a plain send to a workspace that is not mounted is dropped', async () => {
    sendWorkspaceCommand(103, { type: 'openTab', tab: 'publish' });
    const handle = vi.fn();
    const hook = renderHook(() => useWorkspaceCommands(103, handle));
    await settle();
    expect(handle).not.toHaveBeenCalled();
    hook.unmount();
  });

  it('`whenReady` waits for the workspace to mount, then delivers once to EVERY handler it mounted', async () => {
    sendWorkspaceCommand(104, { type: 'openTab', tab: 'publish' }, { whenReady: true });
    const first = vi.fn();
    const second = vi.fn();
    const hook = renderHook(() => {
      useWorkspaceCommands(104, first);
      useWorkspaceCommands(104, second);
    });
    await settle();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    // Delivered, not kept: a later mount does not hear it again.
    hook.unmount();
    const again = vi.fn();
    const remount = renderHook(() => useWorkspaceCommands(104, again));
    await settle();
    expect(again).not.toHaveBeenCalled();
    remount.unmount();
  });

  it('`whenReady` to a workspace already mounted is delivered at once', () => {
    const handle = vi.fn();
    const hook = renderHook(() => useWorkspaceCommands(105, handle));
    sendWorkspaceCommand(105, { type: 'openTab', tab: 'publish' }, { whenReady: true });
    expect(handle).toHaveBeenCalledTimes(1);
    hook.unmount();
  });
});

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { BrainActionsProvider, useBrainActions, type BrainAction } from './BrainActionsContext';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <BrainActionsProvider>{children}</BrainActionsProvider>
);

function action(name: string, run: () => unknown): BrainAction {
  return { name, description: name, parameters: { type: 'object', properties: {} }, run: async () => run() };
}

describe('BrainActionsContext', () => {
  it('exposes registered actions as tool specs and runs them', async () => {
    const { result } = renderHook(() => useBrainActions(), { wrapper });
    act(() => {
      result.current.register([action('create_file', () => 'created')]);
    });
    expect(result.current.toolSpecs.map((t) => t.function.name)).toContain('create_file');

    let out: unknown;
    await act(async () => {
      out = await result.current.runTool('create_file', {});
    });
    expect(out).toBe('created');
  });

  it('returns a recoverable error object for unknown tools', async () => {
    const { result } = renderHook(() => useBrainActions(), { wrapper });
    let out: unknown;
    await act(async () => {
      out = await result.current.runTool('nope', {});
    });
    expect(out).toEqual({ error: 'Unknown tool: nope' });
  });

  it('captures a throwing tool as an error result instead of rejecting', async () => {
    const { result } = renderHook(() => useBrainActions(), { wrapper });
    act(() => {
      result.current.register([
        { name: 'boom', description: '', parameters: {}, run: async () => { throw new Error('kaboom'); } },
      ]);
    });
    let out: unknown;
    await act(async () => {
      out = await result.current.runTool('boom', {});
    });
    expect(out).toEqual({ error: 'kaboom' });
  });

  it('last writer wins, and unmounting the old owner does not clobber the newer entry', async () => {
    const { result } = renderHook(() => useBrainActions(), { wrapper });
    let unregV1!: () => void;
    act(() => {
      unregV1 = result.current.register([action('a', () => 'v1')]);
    });
    act(() => {
      // v2 takes over the same name
      result.current.register([action('a', () => 'v2')]);
    });
    // Only one 'a' spec, owned by v2
    expect(result.current.toolSpecs.filter((t) => t.function.name === 'a')).toHaveLength(1);

    // The stale v1 owner unmounts — must NOT delete v2's entry
    act(() => { unregV1(); });
    expect(result.current.toolSpecs.some((t) => t.function.name === 'a')).toBe(true);

    let out: unknown;
    await act(async () => {
      out = await result.current.runTool('a', {});
    });
    expect(out).toBe('v2');
  });
});

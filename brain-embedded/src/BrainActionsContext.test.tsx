import { describe, it, expect } from 'vitest';
import { render, renderHook, act } from '@testing-library/react';
import React from 'react';
import {
  BrainActionsProvider,
  useBrainActions,
  useRegisterBrainActions,
  type BrainAction,
  type BrainActionsContextValue,
} from './BrainActionsContext';

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

/**
 * The production outage this suite exists to prevent (2026-08-22).
 *
 * A registrant that rebuilt its action array every render re-registered every
 * render; registering bumped the registry version; the bump rebuilt the context
 * value; and the registrant, subscribed to that context, re-rendered — forever.
 * React never reached an idle frame, so every `next/link` navigation (a
 * transition) was starved and NO LINK ON THE SITE WORKED.
 *
 * These tests pass a DELIBERATELY unstable array, which is what a caller who
 * forgets to `useMemo` produces.
 */
describe('BrainActionsContext — registration is loop-proof', () => {
  /**
   * Fresh array, fresh closures, every single render — and an UNCHANGED
   * declaration. This is the real shape of the bug: `WidgetBrainBridge`'s
   * actions were rebuilt because `useComponentLabel()` handed it a new function
   * identity each render, not because anything it told the model had changed.
   */
  function Registrant({ value, onRender }: { value: string; onRender?: () => void }) {
    onRender?.();
    useRegisterBrainActions([
      { name: 'live', description: 'live', parameters: { type: 'object', properties: {} }, run: () => value },
    ]);
    return null;
  }

  /** A bridge whose PARAMETERS are compiled from data (the widget/destination shape). */
  function DataDrivenRegistrant({ ids }: { ids: string[] }) {
    useRegisterBrainActions([
      {
        name: 'pick',
        description: 'pick one',
        parameters: { type: 'object', properties: { id: { type: 'string', enum: ids } } },
        run: (args: unknown) => (args as { id: string }).id,
      },
    ]);
    return null;
  }

  function Other() {
    useRegisterBrainActions([
      { name: 'other', description: 'other', parameters: { type: 'object', properties: {} }, run: () => 'other' },
    ]);
    return null;
  }

  const harness = () => {
    let api!: BrainActionsContextValue;
    function Reader() { api = useBrainActions(); return null; }
    return { Reader, read: () => api };
  };

  it('does not re-register — or re-render the registry — when an unstable array is rebuilt', () => {
    const { Reader, read } = harness();
    let renders = 0;
    const { rerender } = render(
      <BrainActionsProvider>
        <Registrant value="v1" onRender={() => { renders += 1; }} />
        <Reader />
      </BrainActionsProvider>,
    );
    expect(read().toolSpecs.map((t) => t.function.name)).toContain('live');

    const specsBefore = read().toolSpecs;
    const rendersAfterMount = renders;

    rerender(
      <BrainActionsProvider>
        <Registrant value="v2" onRender={() => { renders += 1; }} />
        <Reader />
      </BrainActionsProvider>,
    );

    // The array identity changed; the NAMES did not — so nothing re-registered,
    // the version never bumped, and `toolSpecs` is the very same array.
    expect(read().toolSpecs).toBe(specsBefore);
    // Exactly one more render: the one we asked for. No feedback loop.
    expect(renders).toBe(rendersAfterMount + 1);
  });

  it('runs the LATEST handler even though it never re-registered', async () => {
    const { Reader, read } = harness();
    const { rerender } = render(
      <BrainActionsProvider><Registrant value="v1" /><Reader /></BrainActionsProvider>,
    );
    let out: unknown;
    await act(async () => { out = await read().runTool('live', {}); });
    expect(out).toBe('v1');

    rerender(<BrainActionsProvider><Registrant value="v2" /><Reader /></BrainActionsProvider>);
    await act(async () => { out = await read().runTool('live', {}); });
    // Skipping the re-registration must not mean running yesterday's closure.
    expect(out).toBe('v2');
  });

  it('DOES re-register when the declared contract changes, so a data-driven enum cannot go stale', () => {
    const { Reader, read } = harness();
    const enumOf = () => {
      const spec = read().toolSpecs.find((t) => t.function.name === 'pick');
      const props = (spec?.function.parameters as { properties?: { id?: { enum?: string[] } } })?.properties;
      return props?.id?.enum;
    };
    const { rerender } = render(
      <BrainActionsProvider><DataDrivenRegistrant ids={['a']} /><Reader /></BrainActionsProvider>,
    );
    expect(enumOf()).toEqual(['a']);

    // The ids a bridge knows about arrive with auth/entitlements, AFTER mount.
    rerender(<BrainActionsProvider><DataDrivenRegistrant ids={['a', 'b']} /><Reader /></BrainActionsProvider>);
    expect(enumOf()).toEqual(['a', 'b']);
  });

  it('does not re-render a registrant when somebody else changes the registry', () => {
    const { Reader, read } = harness();
    let renders = 0;
    const { rerender } = render(
      <BrainActionsProvider>
        <Registrant value="v1" onRender={() => { renders += 1; }} />
        <Reader />
      </BrainActionsProvider>,
    );
    const rendersAfterMount = renders;

    act(() => { read().register([{ name: 'external', description: 'x', parameters: {}, run: () => 'x' }]); });

    expect(read().toolSpecs.map((t) => t.function.name)).toContain('external');
    // The registry changed; a registrant subscribes to the STABLE registrar seam
    // only, so it did not re-render — which is what breaks the loop.
    expect(renders).toBe(rendersAfterMount);

    // And an unrelated registrant mounting is equally quiet.
    rerender(
      <BrainActionsProvider>
        <Registrant value="v1" onRender={() => { renders += 1; }} />
        <Other />
        <Reader />
      </BrainActionsProvider>,
    );
    expect(read().toolSpecs.map((t) => t.function.name)).toContain('other');
    expect(renders).toBe(rendersAfterMount + 1); // the rerender itself, nothing more
  });

  it('unregisters on unmount', () => {
    const { Reader, read } = harness();
    const { rerender } = render(
      <BrainActionsProvider><Registrant value="v1" /><Reader /></BrainActionsProvider>,
    );
    expect(read().toolSpecs.map((t) => t.function.name)).toContain('live');
    rerender(<BrainActionsProvider><Reader /></BrainActionsProvider>);
    expect(read().toolSpecs.map((t) => t.function.name)).not.toContain('live');
  });
});

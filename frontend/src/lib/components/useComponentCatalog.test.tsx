/**
 * @vitest-environment jsdom
 *
 * `src/lib/**` runs in the node project by default, and these render hooks.
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useComponentCatalog, useComponentLabel } from './useComponentCatalog';
import type { ComponentMount } from './types';

/**
 * REFERENTIAL STABILITY, WHICH IS A CORRECTNESS PROPERTY HERE AND NOT A
 * MICRO-OPTIMISATION.
 *
 * `useComponentLabel` shipped returning a fresh arrow function on every render.
 * `WidgetBrainBridge` lists it as a `useMemo` dependency, so a new identity per
 * render rebuilt its Brain action array per render, which re-registered the
 * widget tools, which bumped the Brain registry, which re-rendered the bridge.
 * The app never reached an idle frame and every `next/link` navigation on the
 * site — a React transition — was starved: no link anywhere navigated.
 *
 * Nothing in the existing suite could catch that. Every test asserted what the
 * hooks RETURN, and the return values were correct the whole time; the defect was
 * in the identity of the function carrying them. So the assertion has to be about
 * identity across renders, and it has to live next to the hooks rather than in
 * the one consumer that happened to expose it — the next consumer to put either
 * of these in a dependency array should not have to rediscover this.
 */

describe('useComponentLabel', () => {
  it('keeps one identity across renders', () => {
    const { result, rerender } = renderHook(() => useComponentLabel());
    const first = result.current;
    rerender();
    rerender();
    expect(result.current).toBe(first);
  });

  it('still resolves a label', () => {
    const { result } = renderHook(() => useComponentLabel());
    // The global next-intl mock returns the key, which is all this needs: the
    // point is that the function WORKS, not what the copy says. Real-copy
    // assertions live in `ComponentPicker.test.tsx`.
    expect(result.current({ titleKey: 'app.kanban' })).toBe('components.title.app.kanban');
  });
});

describe('useComponentCatalog', () => {
  it('returns the same array when nothing about the question changed', () => {
    const { result, rerender } = renderHook(({ q }: { q: string }) => useComponentCatalog('canvas', q), {
      initialProps: { q: '' },
    });
    const first = result.current;
    rerender({ q: '' });
    expect(result.current).toBe(first);
  });

  it('rebuilds when the query changes, and only then', () => {
    const { result, rerender } = renderHook(({ q }: { q: string }) => useComponentCatalog('canvas', q), {
      initialProps: { q: '' },
    });
    const all = result.current;
    rerender({ q: 'kanban' });
    expect(result.current).not.toBe(all);
    const filtered = result.current;
    // Whitespace and case are normalised into the same question, so a trailing
    // space must not look like a new one.
    rerender({ q: ' KANBAN ' });
    expect(result.current).toBe(filtered);
  });

  it('changes with the mount, so two mounts cannot share a cached answer', () => {
    // `renderHook` infers its prop type from `initialProps`, NOT from the
    // callback's annotation — so `{ m: 'canvas' as const }` narrowed the whole
    // hook to the literal `'canvas'` and the rerender below could not type-check
    // against it. Annotating the props type once, here, is what lets both mounts
    // through; the `as const` was doing the opposite of what it looked like.
    const props: { m: ComponentMount } = { m: 'canvas' };
    const { result, rerender } = renderHook(({ m }: { m: ComponentMount }) => useComponentCatalog(m, ''), {
      initialProps: props,
    });
    const canvas = result.current;
    rerender({ m: 'dashboard' });
    expect(result.current).not.toBe(canvas);
  });
});

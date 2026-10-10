import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  clearPreviewPick,
  getPreviewPick,
  previewPickContext,
  previewPickExcerpt,
  setPreviewPick,
  takePreviewPick,
  useOnPreviewPick,
  usePreviewPick,
  useSpendPreviewPickOnSettle,
  type PreviewPick,
} from './previewPick';

const pick = (over: Partial<PreviewPick> = {}): PreviewPick => ({
  file: 'src/App.jsx', line: 12, column: 4, tag: 'h1', className: 'text-4xl', text: 'Hello World!',
  workspaceId: 'local:app', appName: 'Phone plans', ...over,
});

afterEach(() => clearPreviewPick());

describe('the preview pick — "Select to edit" as context for the ONE prompt', () => {
  it('holds one pick per window; a new pick replaces the old', () => {
    setPreviewPick(pick());
    const second = pick({ line: 20 });
    setPreviewPick(second);
    expect(getPreviewPick()).toBe(second);
  });

  it('take reads and withdraws — the turn being sent is the one it was for', () => {
    const first = pick();
    setPreviewPick(first);
    expect(takePreviewPick()).toBe(first);
    expect(getPreviewPick()).toBeNull();
  });

  it('a workspace withdraws only its own pick', () => {
    setPreviewPick(pick({ workspaceId: 'local:other' }));
    clearPreviewPick({ workspaceId: 'local:app' });
    expect(getPreviewPick()).not.toBeNull();
    clearPreviewPick({ workspaceId: 'local:other' });
    expect(getPreviewPick()).toBeNull();
  });

  it('a spent pick never wipes a newer one', () => {
    const old = pick();
    setPreviewPick(old);
    const newer = pick({ line: 30 });
    setPreviewPick(newer);
    clearPreviewPick(old);
    expect(getPreviewPick()).toBe(newer);
  });

  it('tells the model the element, its file and its line', () => {
    const note = previewPickContext(pick());
    expect(note).toContain('"Phone plans"');
    expect(note).toContain('<h1>');
    expect(note).toContain('`src/App.jsx` at line 12');
    expect(note).toContain('"Hello World!"');
    expect(note).toContain('"text-4xl"');
  });

  it('shortens long text for a chip', () => {
    expect(previewPickExcerpt('  a   b  ')).toBe('a b');
    expect(previewPickExcerpt('x'.repeat(80), 10)).toBe(`${'x'.repeat(9)}…`);
    expect(previewPickExcerpt(null)).toBeNull();
  });

  it('is live in React', () => {
    const { result } = renderHook(() => usePreviewPick());
    expect(result.current).toBeNull();
    const next = pick();
    act(() => setPreviewPick(next));
    expect(result.current).toBe(next);
  });

  it('reveals the host\'s prompt when a pick arrives', () => {
    let revealed = 0;
    renderHook(() => useOnPreviewPick(() => { revealed += 1; }));
    expect(revealed).toBe(0);
    act(() => setPreviewPick(pick()));
    expect(revealed).toBe(1);
  });

  it('the workspace Brain spends the pick its turn carried, once that turn settles', () => {
    const carried = pick();
    setPreviewPick(carried);
    const { rerender } = renderHook(({ sending }) => useSpendPreviewPickOnSettle(sending), { initialProps: { sending: false } });
    rerender({ sending: true });
    expect(getPreviewPick()).toBe(carried);
    rerender({ sending: false });
    expect(getPreviewPick()).toBeNull();
  });

  it('keeps a pick made while the turn was running', () => {
    setPreviewPick(pick());
    const { rerender } = renderHook(({ sending }) => useSpendPreviewPickOnSettle(sending), { initialProps: { sending: false } });
    rerender({ sending: true });
    const newer = pick({ line: 40 });
    act(() => setPreviewPick(newer));
    rerender({ sending: false });
    expect(getPreviewPick()).toBe(newer);
  });
});

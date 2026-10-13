// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  clearPreviewPicks,
  getPreviewPicks,
  previewPickContext,
  previewPickExcerpt,
  previewPicksContext,
  removePreviewPick,
  setPreviewPick,
  setPreviewPicks,
  takePreviewPicks,
  useOnPreviewPick,
  usePreviewPicks,
  useSpendPreviewPicksOnSettle,
  type PreviewPick,
} from './previewPick';

/** A source-anchored pick: an element clicked in a live preview (file:line). */
const pick = (over: Partial<PreviewPick['anchor']> = {}, owner: PreviewPick['owner'] = 'local:app'): PreviewPick => ({
  owner,
  appName: 'Phone plans',
  anchor: { kind: 'source', file: 'src/App.jsx', line: 12, column: 4, tag: 'h1', className: 'text-4xl', text: 'Hello World!', ...over } as PreviewPick['anchor'],
});

/** A selector-anchored pick: an element a fix changes (Insights "Apply in composer"). */
const element = (selector: string, label: string, pagePath = '/pricing'): PreviewPick => ({
  owner: 'surface:insights',
  appName: null,
  anchor: { kind: 'selector', selector, label, pagePath },
});

afterEach(() => clearPreviewPicks());

describe('the preview picks — elements as context for the ONE prompt', () => {
  it('a preview holds one source pick; its new click replaces the old', () => {
    setPreviewPick(pick());
    const second = pick({ line: 20 });
    setPreviewPick(second);
    expect(getPreviewPicks()).toEqual([second]);
  });

  it('holds many picks at once, from different owners', () => {
    const source = pick();
    setPreviewPick(source);
    const a = element('button.buy', 'Buy now');
    const b = element('#hero h1', 'Plans for everyone');
    setPreviewPicks('surface:insights', [a, b]);
    expect(getPreviewPicks()).toEqual([source, a, b]);
  });

  it('an owner replaces its own set, drops duplicates, and leaves others alone', () => {
    const source = pick();
    setPreviewPick(source);
    setPreviewPicks('surface:insights', [element('button.buy', 'Buy now')]);
    const next = element('#cta', 'Start');
    setPreviewPicks('surface:insights', [next, element('#cta', 'Start')]);
    expect(getPreviewPicks()).toEqual([source, next]);
    setPreviewPicks('surface:insights', []);
    expect(getPreviewPicks()).toEqual([source]);
  });

  it('removes one pick — a chip\'s × — and keeps the rest', () => {
    const a = element('button.buy', 'Buy now');
    const b = element('#hero h1', 'Plans');
    setPreviewPicks('surface:insights', [a, b]);
    removePreviewPick(a);
    expect(getPreviewPicks()).toEqual([b]);
  });

  it('take reads and withdraws every pick — the turn being sent is the one they were for', () => {
    const a = pick();
    const b = element('button.buy', 'Buy now');
    setPreviewPick(a);
    setPreviewPicks('surface:insights', [b]);
    expect(takePreviewPicks()).toEqual([a, b]);
    expect(getPreviewPicks()).toEqual([]);
  });

  it('an owner withdraws only its own picks', () => {
    setPreviewPick(pick({}, 'local:other'));
    setPreviewPicks('surface:insights', [element('button.buy', 'Buy now')]);
    clearPreviewPicks({ owner: 'local:app' });
    expect(getPreviewPicks()).toHaveLength(2);
    clearPreviewPicks({ owner: 'local:other' });
    expect(getPreviewPicks()).toHaveLength(1);
    expect(getPreviewPicks()[0]!.anchor.kind).toBe('selector');
  });

  it('tells the model a source pick\'s element, its file and its line', () => {
    const note = previewPickContext(pick());
    expect(note).toContain('"Phone plans"');
    expect(note).toContain('<h1>');
    expect(note).toContain('`src/App.jsx` at line 12');
    expect(note).toContain('"Hello World!"');
    expect(note).toContain('"text-4xl"');
  });

  it('tells the model a selector pick as element `<label>` (`<selector>`) on `<page>`', () => {
    expect(previewPickContext(element('button.buy', 'Buy now'))).toContain('element `Buy now` (`button.buy`) on `/pricing`');
    // A masked region has no label: the selector alone names it.
    expect(previewPickContext(element('#card input', ''))).toContain('element `#card input` on `/pricing`');
  });

  it('the turn note carries every pick, one paragraph each, and nothing when none', () => {
    const note = previewPicksContext([pick(), element('button.buy', 'Buy now'), element('#hero h1', 'Plans', '/')]);
    expect(note.split('\n\n')).toHaveLength(3);
    expect(note).toContain('`src/App.jsx` at line 12');
    expect(note).toContain('element `Buy now` (`button.buy`) on `/pricing`');
    expect(note).toContain('element `Plans` (`#hero h1`) on `/`');
    expect(previewPicksContext([])).toBe('');
  });

  it('shortens long text for a chip', () => {
    expect(previewPickExcerpt('  a   b  ')).toBe('a b');
    expect(previewPickExcerpt('x'.repeat(80), 10)).toBe(`${'x'.repeat(9)}…`);
    expect(previewPickExcerpt(null)).toBeNull();
  });

  it('is live in React', () => {
    const { result } = renderHook(() => usePreviewPicks());
    expect(result.current).toEqual([]);
    const next = pick();
    act(() => setPreviewPick(next));
    expect(result.current).toEqual([next]);
  });

  it('reveals the host\'s prompt when a NEW pick arrives, not when one is withdrawn', () => {
    let revealed = 0;
    renderHook(() => useOnPreviewPick(() => { revealed += 1; }));
    expect(revealed).toBe(0);
    const a = element('button.buy', 'Buy now');
    act(() => setPreviewPicks('surface:insights', [a, element('#cta', 'Start')]));
    expect(revealed).toBe(1);
    act(() => removePreviewPick(a));
    expect(revealed).toBe(1);
  });

  it('the workspace Brain spends the picks its turn carried, once that turn settles', () => {
    const carried = pick();
    setPreviewPick(carried);
    const { rerender } = renderHook(({ sending }) => useSpendPreviewPicksOnSettle(sending), { initialProps: { sending: false } });
    rerender({ sending: true });
    expect(getPreviewPicks()).toEqual([carried]);
    rerender({ sending: false });
    expect(getPreviewPicks()).toEqual([]);
  });

  it('keeps a pick made while the turn was running', () => {
    setPreviewPick(pick());
    const { rerender } = renderHook(({ sending }) => useSpendPreviewPicksOnSettle(sending), { initialProps: { sending: false } });
    rerender({ sending: true });
    const newer = element('#cta', 'Start');
    act(() => setPreviewPicks('surface:insights', [newer]));
    rerender({ sending: false });
    expect(getPreviewPicks()).toEqual([newer]);
  });
});

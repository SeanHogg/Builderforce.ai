import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  computeCollectionFitHeight,
  MIN_FIT_HEIGHT,
  resolveScrollRoot,
  useCollectionFitHeight,
} from './useCollectionFitHeight';

describe('computeCollectionFitHeight', () => {
  it('regression: fills exactly the room left under the page title (header + footer stay visible)', () => {
    // /workforce?tab=roles: ~250px of headings above a Collection in an 800px scroller.
    expect(computeCollectionFitHeight({ available: 800, offset: 250 })).toBe(550);
  });

  it('fills the whole area when the Collection is at the top of the page', () => {
    expect(computeCollectionFitHeight({ available: 800, offset: 0 })).toBe(800);
  });

  it('uses the full viewport when the Collection starts far down the page', () => {
    // Only 200px left under stacked sections: scrolled to, it should fit the viewport.
    expect(computeCollectionFitHeight({ available: 800, offset: 600 })).toBe(800);
    expect(computeCollectionFitHeight({ available: 800, offset: 2000 })).toBe(800);
  });

  it('switches at the MIN_FIT_HEIGHT threshold', () => {
    expect(computeCollectionFitHeight({ available: 1000, offset: 1000 - MIN_FIT_HEIGHT })).toBe(MIN_FIT_HEIGHT);
    expect(computeCollectionFitHeight({ available: 1000, offset: 1000 - MIN_FIT_HEIGHT + 1 })).toBe(1000);
  });

  it('on a short viewport the threshold is the viewport itself', () => {
    // available < MIN_FIT_HEIGHT: any offset > 0 falls back to the full area.
    expect(computeCollectionFitHeight({ available: 300, offset: 0 })).toBe(300);
    expect(computeCollectionFitHeight({ available: 300, offset: 10 })).toBe(300);
  });

  it('never returns a negative height', () => {
    expect(computeCollectionFitHeight({ available: -5, offset: 0 })).toBe(0);
  });
});

describe('computeCollectionFitHeight trailing space', () => {
  it('keeps a small trailing space (wrapper padding, a short note) in view', () => {
    expect(computeCollectionFitHeight({ available: 800, offset: 250, trailing: 24 })).toBe(526);
  });

  it('ignores a large trailing space', () => {
    expect(computeCollectionFitHeight({ available: 800, offset: 250, trailing: 400 })).toBe(550);
  });
});

const rect = (top: number, height: number): DOMRect =>
  ({ top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

function mount(html: string): { root: HTMLElement; scroller: HTMLElement | null } {
  document.body.innerHTML = html;
  return {
    root: document.querySelector<HTMLElement>('[data-testid="root"]')!,
    scroller: document.querySelector<HTMLElement>('[data-testid="scroller"]'),
  };
}

describe('resolveScrollRoot', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('finds the shell .content scroller', () => {
    const { root, scroller } = mount(
      '<div class="content" data-testid="scroller" style="overflow-y:auto"><div><div data-testid="root"></div></div></div>',
    );
    expect(resolveScrollRoot(root)).toBe(scroller);
  });

  it('regression: ignores an overflow-x-only wrapper (it computes overflow-y:auto too)', () => {
    const { root, scroller } = mount(
      '<div class="content" data-testid="scroller" style="overflow-y:auto">'
        + '<div class="table-wrap" style="overflow-x:auto"><div data-testid="root"></div></div></div>',
    );
    expect(resolveScrollRoot(root)).toBe(scroller);
  });

  it('finds an opt-in data-scroll-root and a panel body', () => {
    const a = mount('<div data-scroll-root data-testid="scroller" style="overflow-y:scroll"><div data-testid="root"></div></div>');
    expect(resolveScrollRoot(a.root)).toBe(a.scroller);
    const b = mount('<div class="ui-panel-body" data-testid="scroller" style="overflow-y:auto"><div data-testid="root"></div></div>');
    expect(resolveScrollRoot(b.root)).toBe(b.scroller);
  });

  it('returns null with no scroll root, or one that is not scrolling (full-height mode)', () => {
    const none = mount('<div style="overflow-y:auto"><div data-testid="root"></div></div>');
    expect(resolveScrollRoot(none.root)).toBeNull();
    const hidden = mount('<div class="content app-full-height" style="overflow:hidden"><div data-testid="root"></div></div>');
    expect(resolveScrollRoot(hidden.root)).toBeNull();
  });
});

describe('useCollectionFitHeight', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('caps to the room left under the page title in the .content scroller', async () => {
    const { root, scroller } = mount(
      '<div class="content" data-testid="scroller" style="overflow-y:auto;padding-top:20px;padding-bottom:20px">'
        + '<h1 style="height:230px">Title</h1><div data-testid="root"></div></div>',
    );
    Object.defineProperty(scroller!, 'clientHeight', { configurable: true, value: 840 });
    scroller!.getBoundingClientRect = () => rect(56, 840);
    // Root starts 250px into the scroller's content box (20px padding + 230px title).
    root.getBoundingClientRect = () => rect(56 + 20 + 230, 300);
    const { result } = renderHook(() => useCollectionFitHeight({ current: root }));
    // available = 840 - 40 = 800; offset = 230; fit = 570.
    await waitFor(() => expect(result.current).toBe(570));
  });

  it('returns undefined when there is no scroll root', async () => {
    const { root } = mount('<div><div data-testid="root"></div></div>');
    const { result } = renderHook(() => useCollectionFitHeight({ current: root }));
    await new Promise((r) => window.requestAnimationFrame(() => r(null)));
    expect(result.current).toBeUndefined();
  });
});

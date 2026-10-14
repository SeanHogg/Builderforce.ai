import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReplayMark } from '@builderforce/interaction-contract';
import { MarkTracker, watchQuiet, type QuietWatcher } from './marks';

function tracker(opts: { watch?: QuietWatcher; pages?: Array<{ path: string; t: number }> } = {}) {
  const marks: ReplayMark[] = [];
  let clock = 1_000;
  const t = new MarkTracker({
    emit: (m) => marks.push(m),
    now: () => clock,
    pages: opts.pages,
    watchQuiet: opts.watch ?? ((_ms, done) => done(false)),
  });
  return { t, marks, advance: (ms: number) => { clock += ms; } };
}

function button(): Element {
  return document.createElement('button');
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('page and quick back', () => {
  it('emits a templated page mark', () => {
    const { t, marks } = tracker();
    t.page('/orders/1234?x=1');
    expect(marks).toEqual([{ kind: 'page', key: '/orders/:id', atMs: 1_000 }]);
  });

  it('emits quickback on A→B→A with a short stay on B, across page loads', () => {
    const { t, marks, advance } = tracker({ pages: [{ path: '/a', t: 0 }] });
    advance(500);
    t.page('/b');
    advance(2_000);
    t.page('/a');
    expect(marks.map((m) => m.kind)).toEqual(['page', 'page', 'quickback']);
    expect(marks[2]).toMatchObject({ kind: 'quickback', key: '/a' });
  });

  it('does not emit quickback after a long stay', () => {
    const { t, marks, advance } = tracker();
    t.page('/a');
    t.page('/b');
    advance(8_000);
    t.page('/a');
    expect(marks.some((m) => m.kind === 'quickback')).toBe(false);
  });
});

describe('clicks', () => {
  const click = { x: 10, y: 10, gx: 1, gy: 2, selector: 'getByRole("button", { name: "Buy" })', label: 'Buy' };

  it('emits a click mark with grid cell, selector, label and href', () => {
    const { t, marks } = tracker();
    t.click({ ...click, el: button(), href: '/checkout' });
    expect(marks).toEqual([{ kind: 'click', key: click.selector, label: 'Buy', atMs: 1_000, gx: 1, gy: 2, href: '/checkout' }]);
  });

  it('emits rage on the third click inside 700 ms and 30 px', () => {
    const { t, marks, advance } = tracker();
    t.click({ ...click, el: button() });
    advance(200);
    t.click({ ...click, x: 20, el: button() });
    advance(200);
    t.click({ ...click, x: 15, el: button() });
    expect(marks.filter((m) => m.kind === 'rage')).toHaveLength(1);
    expect(marks.find((m) => m.kind === 'rage')).toMatchObject({ key: click.selector, gx: 1, gy: 2 });
  });

  it('does not emit rage for slow clicks', () => {
    const { t, marks, advance } = tracker();
    for (let i = 0; i < 3; i++) {
      t.click({ ...click, el: button() });
      advance(400);
    }
    expect(marks.some((m) => m.kind === 'rage')).toBe(false);
  });

  it('emits dead for a quiet click on a non-interactive element only', () => {
    const quiet: QuietWatcher = (_ms, done) => done(true);
    const { t, marks } = tracker({ watch: quiet });
    t.click({ ...click, el: document.createElement('div') });
    t.click({ ...click, x: 500, el: button() });
    expect(marks.filter((m) => m.kind === 'dead')).toHaveLength(1);
  });

  it('does not emit dead when the page reacted', () => {
    const { t, marks } = tracker({ watch: (_ms, done) => done(false) });
    t.click({ ...click, el: document.createElement('div') });
    expect(marks.some((m) => m.kind === 'dead')).toBe(false);
  });
});

describe('watchQuiet', () => {
  it('reports quiet when nothing changes for 500 ms', async () => {
    vi.useFakeTimers();
    const done = vi.fn();
    watchQuiet(500, done);
    await vi.advanceTimersByTimeAsync(500);
    expect(done).toHaveBeenCalledWith(true);
  });

  it('reports not quiet after a DOM mutation', async () => {
    vi.useFakeTimers();
    const done = vi.fn();
    watchQuiet(500, done);
    document.body.appendChild(document.createElement('p'));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);
    expect(done).toHaveBeenCalledWith(false);
  });
});

describe('scroll', () => {
  it('emits excessive_scroll on three reversals', () => {
    const { t, marks, advance } = tracker();
    t.page('/docs');
    for (const y of [0, 400, 100, 500, 50]) {
      t.scroll(y, 800, 0.2);
      advance(200);
    }
    expect(marks.filter((m) => m.kind === 'excessive_scroll')).toEqual([
      expect.objectContaining({ kind: 'excessive_scroll', key: '/docs' }),
    ]);
  });

  it('emits the max depth decile at page leave, then starts over', () => {
    const { t, marks } = tracker();
    t.page('/docs');
    t.scroll(0, 800, 0.35);
    t.scroll(900, 800, 0.72);
    t.scroll(100, 800, 0.4);
    t.leavePage(0.3);
    t.leavePage(0.3);
    const scrolls = marks.filter((m) => m.kind === 'scroll');
    expect(scrolls).toHaveLength(2);
    expect(scrolls[0]).toMatchObject({ key: '/docs', value: 7 });
    expect(scrolls[1]).toMatchObject({ value: 3 });
  });
});

import { describe, expect, it } from 'vitest';
import { unzlibSync } from 'fflate';
import {
  addComicBranch, addComicBubble, addComicPage, createBlankComicState, isInteractiveComic, layoutCells, layoutOf, moveComicPage,
  nextComicPageId, readComicState, removeComicBranch, removeComicBubble, removeComicPage, setComicLayout, updateComicBranch,
  updateComicBubble, updateComicPanel, COMIC_LAYOUTS, isCompleteImageDataUrl,
} from './comicState';
import { wrapLines } from './comicPaint';
import { scaledSize } from './comicImage';
import { ComicExportError, MAX_CANVAS_AREA, MAX_CANVAS_SIDE, stripSize } from './comicExport';
import { buildPdf, rgbaToRgb } from './comicPdf';

// A complete 1x1 PNG: the reader only trusts a data URL that decodes and ends like its format.
const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('comic layouts', () => {
  it('keeps every panel inside the page and clear of its neighbours', () => {
    for (const layout of COMIC_LAYOUTS) {
      const cells = layoutCells(layout);
      for (const [x, y, w, h] of cells) {
        expect(x).toBeGreaterThan(0);
        expect(y).toBeGreaterThan(0);
        expect(x + w).toBeLessThan(1);
        expect(y + h).toBeLessThan(1);
      }
      cells.forEach((a, i) => cells.slice(i + 1).forEach((b) => {
        const apart = a[0] + a[2] <= b[0] || b[0] + b[2] <= a[0] || a[1] + a[3] <= b[1] || b[1] + b[3] <= a[1];
        expect(apart).toBe(true);
      }));
    }
  });

  it('gives 1, 2, 3 and 4 panels', () => {
    expect(COMIC_LAYOUTS.map((layout) => layoutCells(layout).length)).toEqual([1, 2, 3, 4]);
  });

  it('recognises a layout it laid out, and not a hand-moved one', () => {
    const state = createBlankComicState();
    expect(layoutOf(state.pages[0]!, state)).toBe('headline');
    const moved = { ...state.pages[0]!, panels: state.pages[0]!.panels.map((p, i) => i ? p : { ...p, x: p.x + 0.1 }) };
    expect(layoutOf(moved, state)).toBeNull();
  });

  it('keeps the art and lettering already placed when the layout changes', () => {
    let state = createBlankComicState();
    const page = state.pages[0]!;
    const first = page.panels[0]!.id;
    state = updateComicPanel(state, page.id, first, { imageUrl: IMG });
    state = addComicBubble(state, page.id, first).state;
    const grid = setComicLayout(state, page.id, 'grid').pages[0]!;
    expect(grid.panels).toHaveLength(4);
    expect(grid.panels[0]).toMatchObject({ id: first, imageUrl: IMG });
    expect(grid.panels[0]!.bubbles).toHaveLength(1);
    expect(grid.panels[3]!.imageUrl).toBeNull();
  });
});

describe('comic state helpers', () => {
  it('adds, moves and removes pages, dropping branches that pointed at a removed page', () => {
    let state = createBlankComicState();
    const a = state.pages[0]!.id;
    const added = addComicPage(state, 'single');
    state = added.state;
    const b = added.pageId;
    state = addComicBranch(state, a);
    expect(state.pages[0]!.branches[0]!.targetPageId).toBe(b);
    expect(moveComicPage(state, b, 0).pages.map((p) => p.id)).toEqual([b, a]);
    const removed = removeComicPage(state, b);
    expect(removed.state.pages.map((p) => p.id)).toEqual([a]);
    expect(removed.state.pages[0]!.branches).toEqual([]);
    expect(removeComicPage(removed.state, a).state).toBe(removed.state);
  });

  it('adds, edits and removes a bubble, keeping it inside its panel', () => {
    let state = createBlankComicState();
    const page = state.pages[0]!.id;
    const panel = state.pages[0]!.panels[0]!.id;
    const added = addComicBubble(state, page, panel, 'thought');
    state = updateComicBubble(added.state, page, panel, added.bubbleId, { text: 'Hm', x: 4, y: -2 });
    expect(state.pages[0]!.panels[0]!.bubbles[0]).toMatchObject({ kind: 'thought', text: 'Hm', x: 1, y: 0 });
    expect(removeComicBubble(state, page, panel, added.bubbleId).pages[0]!.panels[0]!.bubbles).toEqual([]);
  });

  it('edits and removes branches', () => {
    const page = addComicPage(createBlankComicState());
    let state = addComicBranch(page.state, page.state.pages[0]!.id);
    const pageId = state.pages[0]!.id;
    const branchId = state.pages[0]!.branches[0]!.id;
    state = updateComicBranch(state, pageId, branchId, { label: 'Take the deal', flagsToSet: ['deal'] });
    expect(state.pages[0]!.branches[0]).toMatchObject({ label: 'Take the deal', flagsToSet: ['deal'] });
    expect(removeComicBranch(state, pageId, branchId).pages[0]!.branches).toEqual([]);
  });
});

describe('reading a comic', () => {
  function branched() {
    let state = createBlankComicState();
    const a = state.pages[0]!.id;
    const second = addComicPage(state);
    const third = addComicPage(second.state);
    state = third.state;
    state = addComicBranch(state, a); // targets page 2
    const branchId = state.pages[0]!.branches[0]!.id;
    state = updateComicBranch(state, a, branchId, { targetPageId: third.pageId });
    return { state, a, b: second.pageId, c: third.pageId, branchId };
  }

  it('falls through to the next page when a page has no branches', () => {
    const { state, a, b, c } = branched();
    expect(nextComicPageId(state, b)).toBe(c);
    expect(nextComicPageId(state, c)).toBeNull();
    expect(isInteractiveComic(state)).toBe(true);
    expect(isInteractiveComic(createBlankComicState())).toBe(false);
    expect(a).toBeTruthy();
  });

  it('follows the chosen branch, and stops when none is chosen or the target is gone', () => {
    const { state, a, c, branchId } = branched();
    expect(nextComicPageId(state, a, branchId)).toBe(c);
    expect(nextComicPageId(state, a)).toBeNull();
    expect(nextComicPageId(updateComicBranch(state, a, branchId, { targetPageId: 'gone' }), a, branchId)).toBeNull();
    expect(nextComicPageId(state, 'missing')).toBeNull();
  });
});

describe('readComicState', () => {
  it('falls back to a blank comic for anything unusable', () => {
    for (const value of [undefined, null, 'x', [], [1, 'a']]) expect(readComicState(value).pages).toHaveLength(1);
  });

  it('keeps good data and drops unsafe images and out-of-range numbers', () => {
    const state = readComicState([{
      id: 'p1',
      panels: [{ id: 'a', x: 5, y: -1, w: 2, h: 0, imageUrl: 'javascript:alert(1)', bubbles: [{ id: 'b', kind: 'shout', x: 9, y: 0.4, text: 'Hi' }] },
        { id: 'c', x: 0.1, y: 0.1, w: 0.3, h: 0.3, imageUrl: IMG }],
      branches: [{ id: 'br', label: 'Go', targetPageId: 'p1', flagsToSet: ['a', 4] }],
    }], 5000, 'tall');
    expect(state.width).toBe(800);
    expect(state.height).toBe(1200);
    const panels = state.pages[0]!.panels;
    expect(panels[0]).toMatchObject({ x: 0, y: 0, w: 1, imageUrl: null });
    expect(panels[0]!.h).toBeGreaterThan(0);
    expect(panels[0]!.bubbles[0]).toMatchObject({ kind: 'speech', x: 1, text: 'Hi' });
    expect(panels[1]!.imageUrl).toBe(IMG);
    expect(state.pages[0]!.branches[0]).toMatchObject({ flagsToSet: ['a'] });
  });

  it('regression: a data URL cut short (Brain patches slice strings at 40k) reads as image missing, not a silent grey', () => {
    expect(isCompleteImageDataUrl(IMG)).toBe(true);
    const truncated = IMG.slice(0, 62); // a whole number of base64 groups, so only the trailer can tell
    expect(isCompleteImageDataUrl(truncated)).toBe(false);
    expect(isCompleteImageDataUrl(`${IMG.slice(0, 60)}!`)).toBe(false);
    const panel = (imageUrl: string) => readComicState([{ id: 'p', panels: [{ id: 'a', x: 0, y: 0, w: 1, h: 1, imageUrl }], branches: [] }]).pages[0]!.panels[0]!;
    expect(panel(truncated)).toMatchObject({ imageUrl: null, imageMissing: true });
    expect(panel(IMG)).toMatchObject({ imageUrl: IMG });
    expect(panel(IMG).imageMissing).toBeUndefined();
    // Uploaded art is an https URL, whatever its length.
    expect(panel(`https://cdn.example.com/${'a'.repeat(50_000)}.jpg`).imageUrl).toHaveLength(50_000 + 'https://cdn.example.com/.jpg'.length);
  });

  it('round-trips a state it produced', () => {
    const state = addComicPage(createBlankComicState(), 'grid').state;
    expect(readComicState(JSON.parse(JSON.stringify(state.pages)), state.width, state.height)).toEqual(state);
  });
});

describe('wrapLines', () => {
  const measure = (value: string): number => value.length * 10;

  it('wraps at the width and keeps paragraphs', () => {
    expect(wrapLines('one two three four', 90, measure)).toEqual(['one two', 'three', 'four']);
    expect(wrapLines('a\nb', 100, measure)).toEqual(['a', 'b']);
  });

  it('puts an over-wide word on its own line instead of dropping it', () => {
    expect(wrapLines('hi extraordinarily ok', 60, measure)).toEqual(['hi', 'extraordinarily', 'ok']);
  });
});

describe('buildPdf', () => {
  const page = (width: number, height: number, value: number) => ({ width, height, rgb: new Uint8Array(width * height * 3).fill(value) });

  it('writes a header, one image per page, a dense xref and a correct startxref', () => {
    const bytes = buildPdf([page(2, 2, 10), page(3, 1, 200)]);
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Count 2');
    const startxref = Number(/startxref\n(\d+)\n/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    expect(text).toContain('xref\n0 9\n');
    // Every in-use xref entry points at "<id> 0 obj".
    const entries = [...text.slice(startxref).matchAll(/(\d{10}) 00000 n /g)];
    expect(entries).toHaveLength(8);
    entries.forEach((match, index) => {
      expect(text.slice(Number(match[1]), Number(match[1]) + `${index + 1} 0 obj`.length)).toBe(`${index + 1} 0 obj`);
    });
  });

  it('embeds each page as an inflatable RGB stream of the declared length', () => {
    const bytes = buildPdf([page(2, 2, 77)]);
    const text = new TextDecoder('latin1').decode(bytes);
    const match = /\/Width 2 \/Height 2 [^>]*\/Length (\d+) >>\nstream\n/.exec(text)!;
    const start = match.index + match[0].length;
    const data = bytes.subarray(start, start + Number(match[1]));
    expect(unzlibSync(data)).toEqual(new Uint8Array(12).fill(77));
  });

  it('refuses an empty document', () => {
    expect(() => buildPdf([])).toThrow(/no pages/);
  });
});

describe('rgbaToRgb', () => {
  it('drops alpha, compositing onto white', () => {
    expect([...rgbaToRgb(new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 0]))]).toEqual([0, 0, 0, 255, 255, 255]);
  });
});

describe('scaledSize', () => {
  it('shrinks the longer side to the limit, keeps the ratio and never enlarges', () => {
    expect(scaledSize(2048, 1024, 1024)).toEqual({ width: 1024, height: 512 });
    expect(scaledSize(500, 2000, 1000)).toEqual({ width: 250, height: 1000 });
    expect(scaledSize(300, 200, 1024)).toEqual({ width: 300, height: 200 });
  });
});

describe('png strip size', () => {
  it('keeps a short comic at full size', () => {
    expect(stripSize(800, 1200, 5)).toEqual({ width: 800, height: 6000, scale: 1 });
  });

  it('regression: scales a tall comic down to the browser canvas limits instead of allocating an impossible canvas', () => {
    const size = stripSize(800, 1200, 40);
    expect(size.scale).toBeLessThan(1);
    expect(size.height).toBeLessThanOrEqual(MAX_CANVAS_SIDE);
    expect(size.width * size.height).toBeLessThanOrEqual(MAX_CANVAS_AREA);
  });

  it('refuses a strip that would have to shrink past legibility', () => {
    expect(() => stripSize(800, 1200, 400)).toThrow(ComicExportError);
  });
});

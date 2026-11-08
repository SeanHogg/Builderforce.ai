import { describe, it, expect } from 'vitest';
import { blocksToMarkdown, drawingToMarkdown, parseMarkdownToBlocks, type DocumentBlock } from './blockDocument';
import type { CanvasStroke } from '@/lib/canvasDrawing';

const strokes: CanvasStroke[] = [
  { tool: 'pen', points: [{ x: 1.5, y: 2 }, { x: 30, y: 40.25 }, { x: 55, y: 9 }], stroke: 'currentColor', strokeWidth: 3 },
  { tool: 'rect', points: [{ x: 10, y: 10 }, { x: 90, y: 60 }], stroke: '#ff0000', strokeWidth: 2 },
  { tool: 'text', points: [{ x: 20, y: 80 }], stroke: 'currentColor', strokeWidth: 3, text: 'a `tick` and "quotes"\nnewline' },
];

/** Parsed strokes carry positional runtime ids; the document itself does not. */
const withoutIds = (list: CanvasStroke[] | undefined) => (list ?? []).map(({ id: _id, ...stroke }) => stroke);

/** A bf-drawing fence around a JSON payload. */
const fence = (payload: unknown) => ['```bf-drawing', JSON.stringify(payload), '```'].join('\n');
const line = (stroke: string) => ({ tool: 'line', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], stroke, strokeWidth: 2 });

const drawing = (attrs: DocumentBlock['attrs']): DocumentBlock => ({ id: 'd1', type: 'drawing', text: '', attrs });

describe('drawing block markdown', () => {
  it('round-trips strokes losslessly', () => {
    const markdown = blocksToMarkdown([drawing({ strokes, width: 640, height: 320 })]);
    const [block, ...rest] = parseMarkdownToBlocks(markdown);
    expect(rest).toHaveLength(0);
    expect(block).toMatchObject({ type: 'drawing', text: '', attrs: { width: 640, height: 320 } });
    expect(withoutIds(block?.attrs.strokes)).toEqual(strokes);
    expect(block?.attrs.strokes?.map((stroke) => stroke.id)).toEqual(['s0', 's1', 's2']);
  });

  it('serialises deterministically (parse then serialise is byte-stable)', () => {
    const once = blocksToMarkdown([drawing({ strokes, width: 640, height: 320 })]);
    const twice = blocksToMarkdown(parseMarkdownToBlocks(once));
    expect(twice).toBe(once);
    expect(once.startsWith('```bf-drawing\n')).toBe(true);
  });

  it('keeps an empty drawing a drawing', () => {
    const markdown = blocksToMarkdown([drawing({})]);
    expect(parseMarkdownToBlocks(markdown)[0]).toMatchObject({ type: 'drawing', attrs: { strokes: [], width: 640, height: 320 } });
  });

  it('keeps neighbouring text blocks intact', () => {
    const markdown = blocksToMarkdown([
      { id: 'a', type: 'text', text: 'before', attrs: {} },
      drawing({ strokes }),
      { id: 'b', type: 'text', text: 'after', attrs: {} },
    ]);
    expect(parseMarkdownToBlocks(markdown).map((block) => block.type)).toEqual(['text', 'drawing', 'text']);
  });

  it('degrades a garbled drawing fence to a text block instead of throwing', () => {
    for (const garbled of [
      '```bf-drawing\n{not json\n```',
      '```bf-drawing\n{"strokes":"nope"}\n```',
      '```bf-drawing\nnull\n```',
      '```bf-drawing\n```',
      '```bf-drawing\n{"strokes":[]}',
    ]) {
      const blocks = parseMarkdownToBlocks(garbled);
      expect(blocks.every((block) => block.type === 'text')).toBe(true);
    }
  });

  it('degrades an unknown fence language to a text block', () => {
    const blocks = parseMarkdownToBlocks('```bf-unknown\n{"strokes":[]}\n```');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'text' });
  });

  it('drops unreadable strokes but keeps the drawing', () => {
    const markdown = '```bf-drawing\n{"width":100,"height":50,"strokes":[{"tool":"pen","points":[{"x":0,"y":0}]},{"tool":"line","points":[{"x":0,"y":0},{"x":5,"y":5}],"stroke":"red","strokeWidth":2}]}\n```';
    const [block] = parseMarkdownToBlocks(markdown);
    expect(block?.type).toBe('drawing');
    expect(block?.attrs.strokes).toHaveLength(1);
    expect(block?.attrs.strokes?.[0]?.tool).toBe('line');
  });

  it('replaces an unsafe stroke colour with the default', () => {
    for (const colour of ['red;fill:url(javascript:1)', 'url(#x)', '"><script>', 'x'.repeat(100), '#ggg']) {
      expect(parseMarkdownToBlocks(fence({ width: 100, height: 100, strokes: [line(colour)] }))[0]?.attrs.strokes?.[0]?.stroke).toBe('var(--indigo-bright)');
    }
    for (const colour of ['#abc', '#aabbccdd', 'rgb(1, 2, 3)', 'rgba(1,2,3,0.5)', 'hsl(10 20% 30%)', 'var(--text-primary)', 'currentColor']) {
      expect(parseMarkdownToBlocks(fence({ strokes: [line(colour)] }))[0]?.attrs.strokes?.[0]?.stroke).toBe(colour);
    }
  });

  it('clamps the surface size to 100-4000', () => {
    const read = (width: number, height: number) => parseMarkdownToBlocks(fence({ width, height, strokes: [] }))[0]!.attrs;
    expect(read(1, 99999)).toMatchObject({ width: 100, height: 4000 });
    expect(read(640, 320)).toMatchObject({ width: 640, height: 320 });
  });

  it('keeps the tail of a stroke over the point cap', () => {
    const long = Array.from({ length: 5000 }, (_, index) => ({ x: index, y: 0 }));
    const points = parseMarkdownToBlocks(fence({ strokes: [{ tool: 'pen', points: long, stroke: 'currentColor', strokeWidth: 2 }] }))[0]!.attrs.strokes![0]!.points;
    expect(points).toHaveLength(2000);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[points.length - 1]).toEqual({ x: 4999, y: 0 });
  });

  it('exposes the serialiser for a bare attrs object', () => {
    expect(drawingToMarkdown({ strokes: [] })).toBe('```bf-drawing\n{"width":640,"height":320,"strokes":[]}\n```');
  });
});

import { describe, it, expect } from 'vitest';
import { parseMarkdownToBlocks, type DocumentBlock } from './blockDocument';
import { drawingPlaceholder, restoreAgainstSnapshot, restoreDrawings, toModelText } from './drawingPlaceholders';

const fence = (n: number) => `\`\`\`bf-drawing\n{"width":640,"height":320,"strokes":[{"tool":"pen","points":[{"x":${n},"y":0},{"x":${n + 1},"y":1}],"stroke":"currentColor","strokeWidth":3}]}\n\`\`\``;
const original = (): DocumentBlock[] => parseMarkdownToBlocks(`Intro\n\n${fence(1)}\n\nMiddle\n\n${fence(5)}`);
const drawings = (blocks: readonly DocumentBlock[]) => blocks.filter((block) => block.type === 'drawing');

describe('drawing placeholders', () => {
  it('pins the placeholder format the api documentText.test.ts pins too', () => {
    expect(drawingPlaceholder(2)).toBe('[[bf-drawing:2]]');
  });

  it('toModelText swaps each drawing for a numbered placeholder and no coordinates', () => {
    const text = toModelText(original());
    expect(text).toBe('Intro\n\n[[bf-drawing:1]]\n\nMiddle\n\n[[bf-drawing:2]]');
  });

  it('restoreDrawings puts the original drawing blocks back where the placeholders are', () => {
    const blocks = original();
    const result = parseMarkdownToBlocks('Rewritten\n\n[[bf-drawing:2]]\n\nthen\n\n[[bf-drawing:1]]');
    const restored = restoreDrawings(result, blocks);
    expect(restored.map((block) => block.type)).toEqual(['text', 'drawing', 'text', 'drawing']);
    expect(restored[1]).toBe(blocks[3]);
    expect(restored[3]).toBe(blocks[1]);
  });

  it('regression: a model result without any placeholder still keeps every drawing', () => {
    const blocks = original();
    const restored = restoreDrawings(parseMarkdownToBlocks('A rewrite with no diagram at all.'), blocks);
    expect(drawings(restored).map((block) => block.id)).toEqual(drawings(blocks).map((block) => block.id));
    expect(drawings(restored)[0]!.attrs.strokes).toEqual(drawings(blocks)[0]!.attrs.strokes);
  });

  it('splits a text block that has a placeholder line inside it, and never restores one twice', () => {
    const blocks = original();
    const restored = restoreDrawings(parseMarkdownToBlocks('one\n[[bf-drawing:1]]\ntwo\n[[bf-drawing:1]]'), blocks);
    expect(restored.map((block) => block.type)).toEqual(['text', 'drawing', 'text', 'drawing']);
    expect(drawings(restored)).toHaveLength(2);
    expect(new Set(restored.map((block) => block.id)).size).toBe(restored.length);
  });

  it('regression: a drawing added since the snapshot does not shift the numbering, and is kept', () => {
    const snapshot = original(); // drawings 1 and 2 were sent to the model
    const added = parseMarkdownToBlocks(fence(9))[0]!;
    const live = [snapshot[0]!, added, ...snapshot.slice(1)]; // a new drawing now sits BEFORE them
    const result = parseMarkdownToBlocks('[[bf-drawing:1]]\n\n[[bf-drawing:2]]');
    const restored = restoreAgainstSnapshot(result, snapshot, live);
    expect(restored.slice(0, 2)).toEqual([snapshot[1], snapshot[3]]);
    expect(restored[2]).toBe(added);
    expect(restored).toHaveLength(3);
  });

  it('prefers the live version of a snapshot drawing that was edited meanwhile', () => {
    const snapshot = original();
    const edited = { ...snapshot[1]!, attrs: { ...snapshot[1]!.attrs, width: 321 } };
    const live = snapshot.map((block) => (block.id === edited.id ? edited : block));
    const restored = restoreAgainstSnapshot(parseMarkdownToBlocks('[[bf-drawing:1]]'), snapshot, live);
    expect(restored[0]).toBe(edited);
  });

  it('for an insert (no originals, nothing appended) unknown placeholders are dropped', () => {
    const restored = restoreDrawings(parseMarkdownToBlocks('hello\n\n[[bf-drawing:1]]'), [], false);
    expect(restored.map((block) => block.type)).toEqual(['text']);
  });
});

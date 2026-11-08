import { describe, it, expect } from 'vitest';
import { drawingPlaceholder, knowledgeText } from './documentText';

describe('knowledgeText', () => {
  it('replaces a drawing fence with a numbered placeholder instead of passing its coordinates on', () => {
    const fence = '```bf-drawing\n{"width":640,"height":320,"strokes":[{"tool":"pen"},{"tool":"line"}]}\n```';
    expect(knowledgeText(`before\n\n${fence}\n\nafter`)).toBe('before\n\n[[bf-drawing:1]]\n\nafter');
  });

  it('pins the placeholder format the frontend restores (drawingPlaceholders.test.ts pins the same string)', () => {
    expect(drawingPlaceholder(3)).toBe('[[bf-drawing:3]]');
  });

  it('numbers drawings in order; a garbled payload takes no number', () => {
    const fence = '```bf-drawing\n{"strokes":[]}\n```';
    expect(knowledgeText(`${fence}\n\n\`\`\`bf-drawing\n{nope\n\`\`\`\n\n${fence}`)).toBe('[[bf-drawing:1]]\n\n[drawing]\n\n[[bf-drawing:2]]');
  });

  it('leaves ordinary code fences and text alone', () => {
    const text = '```ts\nconst a = 1;\n```\n\nplain';
    expect(knowledgeText(text)).toBe(text);
  });
});

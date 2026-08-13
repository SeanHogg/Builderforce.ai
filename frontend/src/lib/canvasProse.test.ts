import { describe, expect, it } from 'vitest';
import { canRelevelCanvasObject, canvasProseText } from './canvasProse';
import type { CreationNodeData } from '@/components/creation-canvas/types';

const document = (markdown: string): CreationNodeData => ({ kind: 'document', title: 'Photosynthesis', subtitle: 'Biology notes', markdown });

describe('the words on an object', () => {
  it('reads the body as speech, without the markdown marks', () => {
    const spoken = canvasProseText(document('# Heading\n\nLeaves use **light** to make `sugar`, as shown in [the diagram](https://example.com).\n\n- one\n- two'));
    expect(spoken).toContain('Photosynthesis. Biology notes.');
    expect(spoken).toContain('Leaves use light to make sugar, as shown in the diagram.');
    expect(spoken).not.toContain('#');
    expect(spoken).not.toContain('**');
    expect(spoken).not.toContain('https://example.com');
  });

  it('has nothing to say about a card that is only a label', () => {
    expect(canvasProseText({ kind: 'kpi', title: 'Revenue', status: 'Live', value: 42 } as CreationNodeData)).toBe('');
    expect(canvasProseText(document('Too short.'))).toBe('');
  });

  it('reads a list of authored items when that is where the words are', () => {
    const spoken = canvasProseText({ kind: 'slides', title: 'Deck', items: [{ title: 'Opening', body: 'Why this matters to the class and to the marker' }] } as CreationNodeData);
    expect(spoken).toContain('Why this matters');
  });
});

describe('what can be re-levelled', () => {
  it('offers the rewrite on prose kinds that actually have prose', () => {
    expect(canRelevelCanvasObject(document('A long enough body to be worth rewriting for a younger reader.'))).toBe(true);
  });

  it('never offers it on a kind whose content is rows or coordinates', () => {
    expect(canRelevelCanvasObject({ kind: 'map', title: 'Sites', mapPoints: [{ lat: 1, lng: 2 }] } as CreationNodeData)).toBe(false);
    expect(canRelevelCanvasObject({ kind: 'timer', title: 'Focus', duration: 300 } as CreationNodeData)).toBe(false);
  });
});

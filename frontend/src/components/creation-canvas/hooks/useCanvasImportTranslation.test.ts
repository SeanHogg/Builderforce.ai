import { describe, expect, it } from 'vitest';
import { newNode } from '../canvasNodeHelpers';
import type { CreationFlowNode } from '../CreationNode';
import type { CreationNodeData } from '../types';
import { translationNodeFor } from './useCanvasImportTranslation';

const originalNode = (): CreationFlowNode => {
  const node = newNode('document', { x: 100, y: 50 });
  node.data = { ...node.data, title: 'Guía', markdown: 'Hola mundo' } as CreationNodeData;
  return node;
};

describe('translationNodeFor', () => {
  it('creates a NEW document beside the original and leaves the original untouched', () => {
    const original = originalNode();
    const before = JSON.stringify(original);
    const created = translationNodeFor([original], original.id, { kind: 'document', data: { title: 'Guía', markdown: 'Hello world' } }, 'English', (_c, add) => [...add]);
    expect(created).not.toBeNull();
    expect(created!.id).not.toBe(original.id);
    expect(created!.data.title).toBe('Guía (English)');
    expect((created!.data as { markdown?: string }).markdown).toBe('Hello world');
    expect(created!.position.x).toBeGreaterThan(original.position.x);
    expect(created!.position.y).toBe(original.position.y);
    expect(JSON.stringify(original)).toBe(before);
  });

  it('uses the canvas placer for the final position', () => {
    const original = originalNode();
    const created = translationNodeFor([original], original.id, { kind: 'document', data: { markdown: 'Hi' } }, 'English', (_c, add) => add.map((n) => ({ ...n, position: { x: 999, y: 7 } })));
    expect(created!.position).toEqual({ x: 999, y: 7 });
    expect(created!.data.title).toBe('Guía (English)');
  });

  it('adds nothing when the original is gone', () => {
    expect(translationNodeFor([], 'missing', { kind: 'document', data: { markdown: 'x' } }, 'English', (_c, add) => [...add])).toBeNull();
  });
});

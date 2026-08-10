import { describe, expect, it } from 'vitest';
import { canvasProjectId, canvasProjectNodes, connectedCanvasProjectNode, isCanonicalProjectNode } from './canvasProjectRef';
import type { CreationNodeData } from '@/components/creation-canvas/types';

function node(id: string, data: Partial<CreationNodeData> & { kind: CreationNodeData['kind'] }) {
  return { id, data: { title: id, ...data } as CreationNodeData };
}

describe('canvasProjectId', () => {
  it('reads the canonical project a resourceId points at', () => {
    expect(canvasProjectId({ kind: 'project', title: 'p', resourceId: 'project:12' })).toBe(12);
  });

  it('is kind-agnostic — a Voice object binds to a storage project the same way', () => {
    expect(canvasProjectId({ kind: 'voice', title: 'v', resourceId: 'project:12' })).toBe(12);
  });

  it('is null for an unbound, foreign or malformed reference', () => {
    expect(canvasProjectId({ kind: 'project', title: 'p' })).toBeNull();
    expect(canvasProjectId({ kind: 'project', title: 'p', resourceId: 'agent:12' })).toBeNull();
    expect(canvasProjectId({ kind: 'project', title: 'p', resourceId: 'project:abc' })).toBeNull();
    expect(canvasProjectId({ kind: 'project', title: 'p', resourceId: 'project:0' })).toBeNull();
    expect(canvasProjectId({ kind: 'project', title: 'p', resourceId: 'project:12x' })).toBeNull();
  });
});

describe('isCanonicalProjectNode', () => {
  it('requires both the Project kind and a canonical binding', () => {
    expect(isCanonicalProjectNode({ kind: 'project', title: 'p', resourceId: 'project:1' })).toBe(true);
    expect(isCanonicalProjectNode({ kind: 'project', title: 'p' })).toBe(false);
    expect(isCanonicalProjectNode({ kind: 'voice', title: 'v', resourceId: 'project:1' })).toBe(false);
  });
});

describe('canvasProjectNodes', () => {
  it('returns only bound Project objects, in board order', () => {
    const nodes = [
      node('a', { kind: 'website' }),
      node('b', { kind: 'project', resourceId: 'project:2' }),
      node('c', { kind: 'project' }),
      node('d', { kind: 'project', resourceId: 'project:5' }),
    ];
    expect(canvasProjectNodes(nodes).map((n) => n.id)).toEqual(['b', 'd']);
  });
});

describe('connectedCanvasProjectNode', () => {
  const nodes = [
    node('site', { kind: 'website' }),
    node('p1', { kind: 'project', resourceId: 'project:1' }),
    node('p2', { kind: 'project', resourceId: 'project:2' }),
  ];

  it('prefers a project the object is connected to, in either direction', () => {
    expect(connectedCanvasProjectNode(nodes, [{ source: 'site', target: 'p2' }], 'site')?.id).toBe('p2');
    expect(connectedCanvasProjectNode(nodes, [{ source: 'p2', target: 'site' }], 'site')?.id).toBe('p2');
  });

  // A single-project canvas should just work without the user drawing an edge.
  it('falls back to the first project on the board', () => {
    expect(connectedCanvasProjectNode(nodes, [], 'site')?.id).toBe('p1');
  });

  it('ignores edges that do not touch the object', () => {
    expect(connectedCanvasProjectNode(nodes, [{ source: 'p1', target: 'p2' }], 'site')?.id).toBe('p1');
  });

  it('is undefined when the board has no canonical project', () => {
    expect(connectedCanvasProjectNode([node('site', { kind: 'website' })], [], 'site')).toBeUndefined();
  });
});

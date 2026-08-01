import { describe, expect, it } from 'vitest';
import { createLocalCreationSession, creationGraphFromSnapshot, creationStorageKey, readLocalCreationSession } from './creationSessions';
import type { CreationFlowNode } from '@/components/creation-canvas/CreationNode';

describe('creationGraphFromSnapshot', () => {
  it('persists semantic connection kinds independently from renderer types', () => {
    const nodes: CreationFlowNode[] = [
      { id: '00000000-0000-4000-8000-000000000001', type: 'creation', position: { x: 1, y: 2 }, data: { kind: 'dataset', title: 'Evidence' } },
      { id: '00000000-0000-4000-8000-000000000002', type: 'creation', position: { x: 3, y: 4 }, data: { kind: 'chart', title: 'Chart' } },
    ];
    const graph = creationGraphFromSnapshot({ nodes, edges: [{
      id: '00000000-0000-4000-8000-000000000003', source: nodes[0]!.id, target: nodes[1]!.id,
      type: 'smoothstep', data: { connectionKind: 'data' }, animated: true,
    }] });
    expect(graph.connections[0]).toMatchObject({ kind: 'data', metadata: { rendererType: 'smoothstep', animated: true } });
  });
});

describe('local Creation Session conversation', () => {
  it('records the homepage prompt in a session-owned timeline', () => {
    const id = createLocalCreationSession('Build a new website');
    const session = readLocalCreationSession(id);
    expect(session?.timeline).toHaveLength(1);
    expect(session?.timeline?.[0]).toMatchObject({ role: 'user', body: 'Build a new website' });
  });

  it('keeps the timeline when every Chat placement is removed', () => {
    const id = createLocalCreationSession('Compare these projects');
    const session = readLocalCreationSession(id)!;
    session.nodes = session.nodes.filter((node) => node.data.kind !== 'chat');
    localStorage.setItem(creationStorageKey(id), JSON.stringify(session));
    expect(readLocalCreationSession(id)?.nodes.some((node) => node.data.kind === 'chat')).toBe(false);
    expect(readLocalCreationSession(id)?.timeline?.[0]?.body).toBe('Compare these projects');
  });
});

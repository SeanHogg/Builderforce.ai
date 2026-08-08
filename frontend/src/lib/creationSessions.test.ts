import { beforeEach, describe, expect, it } from 'vitest';
import { createLocalCreationSession, creationGraphFromSnapshot, creationStorageKey, ensureLocalToolCreationSession, listLocalCreationSessions, readLocalCreationSession, removeLocalCreationSession, writeLocalCreationSession } from './creationSessions';
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

  it('persists the rendered footprint used by collision-free AI layout', () => {
    const graph = creationGraphFromSnapshot({
      nodes: [{
        id: '00000000-0000-4000-8000-000000000004', type: 'creation', position: { x: 10, y: 20 },
        width: 240, height: 130, measured: { width: 460, height: 315 },
        data: { kind: 'task', title: 'Tall task' },
      }],
      edges: [],
    });

    expect(graph.objects[0]?.canvasData).toMatchObject({ x: 10, y: 20, w: 460, h: 315 });
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

describe('local tool canvas', () => {
  beforeEach(() => localStorage.clear());

  it('places a catalog tool on a stable, focused canvas', () => {
    const tool = { id: 'ai-dev-maturity', name: 'AI Development Maturity', about: 'Assess delivery maturity.', icon: '◆' };
    const first = ensureLocalToolCreationSession(tool);
    const snapshot = readLocalCreationSession(first.sessionId);

    expect(first).toEqual({ sessionId: 'local-tool-ai-dev-maturity', focusId: 'tool:ai-dev-maturity' });
    expect(snapshot?.nodes).toHaveLength(1);
    expect(snapshot?.nodes[0]).toMatchObject({
      id: first.focusId,
      data: { kind: 'diagnostics', toolId: tool.id, title: tool.name },
    });
    expect(listLocalCreationSessions()).toEqual([]);

    snapshot!.nodes[0]!.data.toolResult = { headline: 'Level 3' };
    writeLocalCreationSession(first.sessionId, snapshot!);
    expect(ensureLocalToolCreationSession(tool)).toEqual(first);
    expect(readLocalCreationSession(first.sessionId)?.nodes[0]?.data.toolResult).toEqual({ headline: 'Level 3' });
  });
});

describe('local Creation Session index', () => {
  beforeEach(() => localStorage.clear());

  it('lists every draft this browser holds, newest first', () => {
    const older = createLocalCreationSession('Older idea');
    const newer = createLocalCreationSession('Newer idea');
    // Same-millisecond creation would make the ordering assertion meaningless.
    const olderSnapshot = readLocalCreationSession(older)!;
    writeLocalCreationSession(older, { ...olderSnapshot, updatedAt: '2020-01-01T00:00:00.000Z' });

    expect(listLocalCreationSessions().map((entry) => entry.sessionId)).toEqual([newer, older]);
  });

  it('adopts a draft written before the index existed', () => {
    const id = createLocalCreationSession('Pre-index board');
    // Exactly the state a real browser is in today: the board is there, the index is not.
    localStorage.removeItem('builderforce:create:index');

    expect(listLocalCreationSessions().map((entry) => entry.sessionId)).toEqual([id]);
  });

  it('drops an index row whose board is gone', () => {
    const kept = createLocalCreationSession('Kept');
    const removed = createLocalCreationSession('Removed');
    removeLocalCreationSession(removed);

    const listed = listLocalCreationSessions().map((entry) => entry.sessionId);
    expect(listed).toEqual([kept]);
    expect(listed).not.toContain(removed);
  });

  it('keeps the indexed title in step with the board as it is edited', () => {
    const id = createLocalCreationSession('First title');
    const snapshot = readLocalCreationSession(id)!;
    writeLocalCreationSession(id, { ...snapshot, title: 'Renamed board' });

    expect(listLocalCreationSessions()[0]).toMatchObject({ sessionId: id, title: 'Renamed board' });
  });
});

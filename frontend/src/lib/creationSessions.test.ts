// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { createLocalCreationSession, creationGraphFromSnapshot, creationStorageKey, listLocalCreationSessions, mergeLocalCreationSessions, readLocalCreationSession, removeLocalCreationSession, updateLocalCreationSession, writeLocalCreationSession } from './creationSessions';
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

describe('legacy tool canvases', () => {
  beforeEach(() => localStorage.clear());

  /**
   * `/tools/<id>` is a reference page now (PRD 21 §11.4.5), not a canvas — but a
   * browser that opened one under the old build still holds a board per
   * diagnostic. Left there they would show up in the canvas switcher as drafts
   * the person never made, and be claimed into the tenant on the next sign-in.
   */
  it('purges the per-diagnostic boards the old tool route left behind', () => {
    const legacy = 'local-tool-ai-dev-maturity';
    localStorage.setItem(creationStorageKey(legacy), JSON.stringify({
      version: 1, title: 'AI Development Maturity', updatedAt: new Date().toISOString(),
      nodes: [{ id: 'tool:ai-dev-maturity', type: 'creation', position: { x: 0, y: 0 }, data: { kind: 'diagnostics', title: 'AI Development Maturity', toolId: 'ai-dev-maturity' } }],
      edges: [],
    }));
    const mine = createLocalCreationSession('A board I actually made');

    expect(listLocalCreationSessions().map((entry) => entry.sessionId)).toEqual([mine]);
    expect(localStorage.getItem(creationStorageKey(legacy))).toBeNull();
  });

  it('does not pre-seed website prompts with the generic ecommerce shell', () => {
    const id = createLocalCreationSession('Design and build a responsive website');
    const session = readLocalCreationSession(id);
    expect(session?.nodes.map((node) => node.data.kind)).toEqual(['chat']);
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

  it('renames and moves a draft while keeping its index synchronized', () => {
    const id = createLocalCreationSession('Loose idea');
    updateLocalCreationSession(id, { title: 'Launch plan', folder: 'Marketing' });

    expect(readLocalCreationSession(id)).toMatchObject({ title: 'Launch plan', folder: 'Marketing' });
    expect(listLocalCreationSessions()[0]).toMatchObject({ sessionId: id, title: 'Launch plan', folder: 'Marketing' });
  });

  it('merges draft graphs and removes the source draft', () => {
    const target = createLocalCreationSession('Target');
    const source = createLocalCreationSession('Source');

    const merged = mergeLocalCreationSessions(target, [source]);

    expect(merged?.nodes).toHaveLength(2);
    expect(readLocalCreationSession(source)).toBeNull();
    expect(listLocalCreationSessions().map((entry) => entry.sessionId)).toEqual([target]);
  });
});

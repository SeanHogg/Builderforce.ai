// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  LOCAL_CREATION_PREFIX,
  isLocalCreationSession,
  localCreationSnapshotFrom,
  mergedLocalCreationSnapshot,
  newLocalCreationBoardSnapshot,
  newLocalCreationSessionSnapshot,
  parseLocalCreationSnapshot,
  type LocalCreationSnapshot,
} from './boardSnapshot';

const node = (id: string, x = 0) => ({ id, type: 'creation' as const, position: { x, y: 0 }, data: { kind: 'sticky' as const, title: id } });

describe('boardSnapshot (pure shaping moved out of localCanvasStore)', () => {
  it('recognises a local session id', () => {
    expect(isLocalCreationSession(`${LOCAL_CREATION_PREFIX}abc`)).toBe(true);
    expect(isLocalCreationSession('1234')).toBe(false);
  });

  it('parses a stored board with defaults, and refuses one without nodes and edges', () => {
    expect(parseLocalCreationSnapshot('{"nodes":[],"edges":[]}')).toMatchObject({ version: 1, title: 'Untitled session', timeline: [], nodes: [], edges: [] });
    expect(parseLocalCreationSnapshot('{"title":"x"}')).toBeNull();
    expect(parseLocalCreationSnapshot('not json')).toBeNull();
    const parsed = parseLocalCreationSnapshot(JSON.stringify({ nodes: [], edges: [], timeline: [{ clientMessageId: 'a', role: 'user', body: 'b', createdAt: 'c' }, { role: 'bogus' }] }));
    expect(parsed?.timeline).toHaveLength(1);
  });

  it('builds a session from a prompt with a one-message transcript and a Brain node', () => {
    const { sessionId, snapshot } = newLocalCreationSessionSnapshot('  Build a site  ');
    expect(sessionId.startsWith(LOCAL_CREATION_PREFIX)).toBe(true);
    expect(snapshot.title).toBe('Build a site');
    expect(snapshot.timeline).toHaveLength(1);
    expect(snapshot.nodes.map((n) => n.data.kind)).toEqual(['chat']);
  });

  it('builds a notes board: an intro card, then stickies, capped at 60', () => {
    const { snapshot } = newLocalCreationBoardSnapshot({ title: 'T', text: 'intro', stickies: Array.from({ length: 70 }, (_, i) => `s${i}`) });
    expect(snapshot.nodes).toHaveLength(61);
    expect(snapshot.nodes[0]!.data.kind).toBe('note');
  });

  it('carries prompt, mode and folder over from the prior snapshot', () => {
    const prior: LocalCreationSnapshot = { version: 1, title: 'a', initialPrompt: 'p', folder: 'f', nodes: [], edges: [], updatedAt: 'x' };
    const next = localCreationSnapshotFrom(prior, { title: 'b', nodes: [node('n')], edges: [] });
    expect(next).toMatchObject({ title: 'b', initialPrompt: 'p', folder: 'f' });
    expect(next.nodes).toHaveLength(1);
  });

  it('merges sources with fresh ids, offset positions, and drops edges whose ends are missing', () => {
    const target: LocalCreationSnapshot = { version: 1, title: 't', nodes: [node('t1')], edges: [], updatedAt: 'x' };
    const source: LocalCreationSnapshot = {
      version: 1, title: 's', nodes: [node('s1'), node('s2', 10)], updatedAt: 'x',
      edges: [{ id: 'e1', source: 's1', target: 's2' }, { id: 'e2', source: 's1', target: 'ghost' }],
    };
    const merged = mergedLocalCreationSnapshot(target, [source]);
    expect(merged.nodes).toHaveLength(3);
    expect(merged.nodes.map((n) => n.id)).not.toContain('s1');
    expect(merged.nodes[1]!.position.x).toBe(120);
    expect(merged.edges).toHaveLength(1);
  });
});

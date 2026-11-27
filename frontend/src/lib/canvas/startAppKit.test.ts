import { describe, expect, it, vi } from 'vitest';
import { composeKit } from '@builderforce/ide-templates/kits';
import type { localCreationSnapshotFrom } from '@/domains/canvas/domain/boardSnapshot';
import { readLocalWorkspace } from '@/lib/workspace/localFileStore';
import { canvasKitById, startAppKit } from './startAppKit';

const { createLocalStarterBoard } = vi.hoisted(() => ({
  createLocalStarterBoard: vi.fn<(snapshot: ReturnType<typeof localCreationSnapshotFrom>) => string>(() => 'board-id'),
}));
vi.mock('@/lib/pendingWork', () => ({ createLocalStarterBoard }));

describe('startAppKit', () => {
  it('stages the composed files and the corresponding build card before opening the board', async () => {
    expect(canvasKitById('unknown')).toBeUndefined();
    const { sessionId, nodeId } = await startAppKit(canvasKitById('react-node')!);

    expect(sessionId).toBe('board-id');
    const [snapshot] = createLocalStarterBoard.mock.lastCall!;
    expect(snapshot.nodes).toEqual([expect.objectContaining({ id: nodeId, data: expect.objectContaining({ kind: 'build', appKit: 'react-node' }) })]);
    expect(await readLocalWorkspace(String(snapshot.nodes[0].data.localAppKey))).toEqual(composeKit('react-node').files);
  });
});

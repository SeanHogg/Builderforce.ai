import { describe, it, expect, vi } from 'vitest';
import { adoptChatProject, type AdoptChatProjectDeps } from './adoptChatProject';
import type { BrainChat } from '@seanhogg/builderforce-brain-embedded';

/**
 * Locks the chat→project self-heal, and specifically the defect it shipped with.
 *
 * The inline version decided from the component's `chats` array — a list fetched with
 * `?projectId=<active>` that the server filters as `project_id = <active>`, so a
 * project-LESS chat is never in it. The lookup missed, the effect bailed, and the
 * self-heal could not fire for the only case it existed for: chat #85 sat unattached
 * for ten turns while the IDE showed BuilderForce.AI selected and Evermind "connected".
 * These tests pin the rule to the CHAT's own record so that cannot recur.
 */

function chat(over: Partial<BrainChat> = {}): BrainChat {
  return { id: 85, title: 'review all tickets', projectId: null, createdAt: '', updatedAt: '', ...over } as BrainChat;
}

function deps(row: BrainChat): AdoptChatProjectDeps & { updateChat: ReturnType<typeof vi.fn> } {
  return {
    getChat: vi.fn(async () => row),
    updateChat: vi.fn(async (_id: number, body: { projectId: number }) => chat({ projectId: body.projectId })),
  } as never;
}

describe('adoptChatProject', () => {
  it('binds the active project onto a chat that has none', async () => {
    const d = deps(chat({ projectId: null }));
    await expect(adoptChatProject(d, 85, 30)).resolves.toBe('adopted');
    expect(d.updateChat).toHaveBeenCalledWith(85, { projectId: 30 });
  });

  it('reads the project from the CHAT, never from a project-scoped list', async () => {
    // The regression: a project-less chat is absent from `listChats({projectId})`, so
    // any implementation consulting that list can't see it. This one asks getChat.
    const d = deps(chat({ projectId: null }));
    await adoptChatProject(d, 85, 30);
    expect(d.getChat).toHaveBeenCalledWith(85);
  });

  it('never re-points a chat deliberately scoped to another project', async () => {
    const d = deps(chat({ projectId: 7 }));
    await expect(adoptChatProject(d, 85, 30)).resolves.toBe('already-scoped');
    expect(d.updateChat).not.toHaveBeenCalled();
  });

  it('does nothing when the IDE has no project selected', async () => {
    const d = deps(chat());
    await expect(adoptChatProject(d, 85, null)).resolves.toBe('no-project');
    expect(d.getChat).not.toHaveBeenCalled();
  });

  it('does nothing when no chat is open', async () => {
    const d = deps(chat());
    await expect(adoptChatProject(d, null, 30)).resolves.toBe('no-project');
    expect(d.getChat).not.toHaveBeenCalled();
  });

  it('reports failure (so the caller can retry) instead of throwing', async () => {
    const d = { getChat: vi.fn(async () => { throw new Error('offline'); }), updateChat: vi.fn() } as never;
    await expect(adoptChatProject(d, 85, 30)).resolves.toBe('failed');
  });

  it('reports failure when the write is rejected', async () => {
    const d = {
      getChat: vi.fn(async () => chat({ projectId: null })),
      updateChat: vi.fn(async () => { throw new Error('403'); }),
    } as never;
    await expect(adoptChatProject(d, 85, 30)).resolves.toBe('failed');
  });
});

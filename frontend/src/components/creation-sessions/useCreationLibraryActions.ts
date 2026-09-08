'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { creationSessionFoldersApi, creationSessionsApi } from '@/lib/builderforceApi';
import { openedBoardHref } from '@/lib/openedBoardHref';
import { trackActivity } from '@/lib/activity/tracker';
import type { CreationLibraryItem, CreationLibraryResource } from '@/domains/canvas/domain/creationLibrary';

/**
 * WRITING to the Create library — opening an item, and everything that can be done
 * to one.
 *
 * ── OPENING IS THE POINT ─────────────────────────────────────────────────────────
 * `open` is what makes the unified list honest. A canvas navigates to its session; a
 * build, workflow, chat, project or agent asks its `…/open` endpoint to MATERIALISE
 * one and navigates to that. Both land on `/create/<id>`, which is why they belong in
 * one list — the old layout drew the second case as a lesser row shape purely because
 * the session row did not exist yet, a fact the person clicking has no stake in.
 *
 * The switch below is the only place that difference is visible, and it is exhaustive
 * on {@link CreationLibraryResource}'s closed union, so a sixth source cannot be added
 * without deciding how it opens.
 */
export interface CreationLibraryActions {
  open: (item: CreationLibraryItem) => Promise<void>;
  /** Archive, or restore when the library is showing the archived reading. */
  archive: (ids: string[]) => Promise<void>;
  remove: (ids: string[]) => Promise<void>;
  merge: (targetId: string, sourceIds: string[]) => Promise<void>;
  pin: (item: CreationLibraryItem) => Promise<void>;
  duplicate: (sessionId: string) => Promise<void>;
  share: (sessionId: string) => void;
  rename: (sessionId: string, title: string) => Promise<void>;
  move: (sessionId: string, folderName: string | null) => Promise<void>;
  linkProject: (sessionId: string, projectId: number) => Promise<void>;
  unlinkProject: (sessionId: string, projectId: number) => Promise<void>;
}

interface Ports {
  /** The reading the library is showing — archive TOGGLES against it. */
  status: 'active' | 'archived';
  /** Re-read the library after a write. */
  reload: () => void;
  /** Re-read the folder list after a write that can create one. */
  reloadFolders: () => void;
  /** Drop the bulk selection after a write that can invalidate it. */
  clearSelection: () => void;
}

/** Turn a record into the session it opens as. Exhaustive by the union, not by a
 *  default branch — see the module header. */
async function openResource(resource: CreationLibraryResource) {
  switch (resource.type) {
    case 'ideProject':
      return { opened: await creationSessionsApi.openIdeProject(Number(resource.id)), extra: { build: '1' } };
    case 'project':
      return { opened: await creationSessionsApi.openProject(Number(resource.id)), extra: undefined };
    case 'workflow':
    case 'chat':
    case 'agent':
      return { opened: await creationSessionsApi.openResource(resource.type, resource.id), extra: undefined };
  }
}

export function useCreationLibraryActions({ status, reload, reloadFolders, clearSelection }: Ports): CreationLibraryActions {
  const router = useRouter();

  const open = useCallback(async (item: CreationLibraryItem) => {
    if (item.sessionId) {
      router.push(openedBoardHref({ sessionId: item.sessionId, objectId: item.focusObjectId }));
      return;
    }
    if (!item.resource) return;
    const { opened, extra } = await openResource(item.resource);
    router.push(openedBoardHref(opened, extra));
  }, [router]);

  // The three write paths every surface shares. One item is the same call with a
  // one-entry list, so the single-item action bar and the bulk bar cannot drift on
  // what "archive" or "delete" actually does.
  const archive = useCallback(async (ids: string[]) => {
    const nextStatus = status === 'archived' ? 'active' : 'archived';
    await Promise.all(ids.map((id) => creationSessionsApi.update(id, { status: nextStatus })));
    if (nextStatus === 'archived') ids.forEach((id) => trackActivity('creation_session_archived', { sessionId: id, metadata: { clientSurface: 'web' } }));
    clearSelection();
    reload();
  }, [clearSelection, reload, status]);

  const remove = useCallback(async (ids: string[]) => {
    await Promise.all(ids.map((id) => creationSessionsApi.remove(id)));
    clearSelection();
    reload();
  }, [clearSelection, reload]);

  const merge = useCallback(async (targetId: string, sourceIds: string[]) => {
    // Sequential: each merge rewrites the target's graph, so they cannot race.
    for (const sourceId of sourceIds) await creationSessionsApi.merge(targetId, sourceId);
    clearSelection();
    reload();
  }, [clearSelection, reload]);

  return {
    open,
    archive,
    remove,
    merge,
    pin: useCallback(async (item: CreationLibraryItem) => {
      if (!item.sessionId) return;
      await creationSessionsApi.pin(item.sessionId, !item.pinned);
      reload();
    }, [reload]),
    duplicate: useCallback(async (sessionId: string) => {
      const copy = await creationSessionsApi.duplicate(sessionId);
      router.push(`/create/${copy.session.id}`);
    }, [router]),
    share: useCallback((sessionId: string) => {
      trackActivity('creation_session_shared', { sessionId, metadata: { clientSurface: 'web', intent: 'open_share' } });
      router.push(`/create/${sessionId}?share=1`);
    }, [router]),
    rename: useCallback(async (sessionId: string, title: string) => {
      await creationSessionsApi.update(sessionId, { title });
      reload();
    }, [reload]),
    move: useCallback(async (sessionId: string, folderName: string | null) => {
      const folderId = folderName ? (await creationSessionFoldersApi.ensure(folderName)).folder.id : null;
      await creationSessionsApi.update(sessionId, { folderId });
      reloadFolders();
      reload();
    }, [reload, reloadFolders]),
    linkProject: useCallback(async (sessionId: string, projectId: number) => {
      await creationSessionsApi.linkProject(sessionId, projectId);
      reload();
    }, [reload]),
    unlinkProject: useCallback(async (sessionId: string, projectId: number) => {
      await creationSessionsApi.unlinkProject(sessionId, projectId);
      reload();
    }, [reload]),
  };
}

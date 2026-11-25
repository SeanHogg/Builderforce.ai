// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { creationSessionsApi, type CreationSessionSummary } from '@/lib/builderforceApi';
import { listLocalCreationSessions, listWorkspaceBoards, readLocalCreationSession } from '@/lib/pendingWork';
import { sessionHasApp } from '@/lib/canvasSessionApp';
import { reportBackgroundFailure } from '@/lib/reportError';
import { studioSessionPath } from '@/lib/studio/studioHost';
import type { StudioCard } from './StudioCardList';

/** One page of the visitor's boards is plenty to find a dozen apps in. */
const SERVER_PAGE = 50;

/** A server board's tile says it holds an app: a `build` object in its preview. */
export function summaryHasApp(session: Pick<CreationSessionSummary, 'preview'>): boolean {
  const preview = session.preview;
  return !!preview && (!!preview.kinds?.includes('build') || !!preview.objects?.some((object) => object.kind === 'build'));
}

/**
 * The boards this device holds that have an app — a guest's included, and a workspace's own, so the
 * list is whole offline. Read from the replica.
 */
async function localStudioCards(): Promise<StudioCard[]> {
  const entries = [...(await listLocalCreationSessions()), ...(await listWorkspaceBoards())];
  const cards: StudioCard[] = [];
  for (const entry of entries) {
    const snapshot = await readLocalCreationSession(entry.sessionId);
    if (snapshot && sessionHasApp(snapshot.nodes)) {
      cards.push({ key: entry.sessionId, href: studioSessionPath(entry.sessionId), title: entry.title, updatedAt: entry.updatedAt });
    }
  }
  return cards;
}

/**
 * The visitor's APPS — every board with an app on it, opened through the Studio lens.
 *
 * What "Build it" makes is a canvas session (`startCreationSession`), so this is where
 * those land: the boards this device holds, and a workspace's boards from the
 * server once the stored session is known. Each opens at `/studio/<sessionId>`, the same
 * board the canvas shows, so the home is a way back in and not only a way to start.
 */
export function useStudioApps(): StudioCard[] {
  const { authReady, hasTenant } = useAuth();
  const [cards, setCards] = useState<StudioCard[]>([]);

  useEffect(() => {
    if (!authReady) return undefined;
    let cancelled = false;
    // The device's own boards first (they are there offline); the server's list adds the rest.
    const localRead = localStudioCards().catch((error: unknown) => {
      void reportBackgroundFailure({ title: 'StudioAppsLocalFailed', message: error instanceof Error ? error.message : String(error), level: 'warning' });
      return [] as StudioCard[];
    });
    void localRead.then((local) => { if (!cancelled) setCards(local); });
    if (!hasTenant) return () => { cancelled = true; };
    creationSessionsApi.list('active', null, { offset: 0, limit: SERVER_PAGE })
      .then(async ({ sessions }) => {
        const local = await localRead;
        if (cancelled) return;
        const held = new Set(local.map((card) => card.key));
        const server = sessions.filter(summaryHasApp).filter((session) => !held.has(session.id)).map((session) => ({
          key: session.id, href: studioSessionPath(session.id), title: session.title, updatedAt: session.lastActivityAt,
        }));
        setCards([...local, ...server]);
      })
      // The device's own apps still stand; the miss is reported, not swallowed.
      .catch((error: unknown) => void reportBackgroundFailure({
        title: 'StudioAppsListFailed',
        message: error instanceof Error ? error.message : String(error),
        level: 'warning',
      }));
    return () => { cancelled = true; };
  }, [authReady, hasTenant]);

  return cards;
}

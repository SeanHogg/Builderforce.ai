// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { creationSessionsApi, type CreationSessionSummary } from '@/lib/builderforceApi';
import { listLocalCreationSessions, readLocalCreationSession } from '@/domains/canvas/infrastructure/localCanvasStore';
import { sessionHasApp } from '@/lib/canvasSessionApp';
import { studioSessionPath } from '@/lib/studio/studioHost';
import type { StudioCard } from './StudioCardList';

const SHOWN = 12;
/** One page of the visitor's boards is plenty to find a dozen apps in. */
const SERVER_PAGE = 50;

/** A server board's tile says it holds an app: a `build` object in its preview. */
export function summaryHasApp(session: Pick<CreationSessionSummary, 'preview'>): boolean {
  const preview = session.preview;
  return !!preview && (!!preview.kinds?.includes('build') || !!preview.objects?.some((object) => object.kind === 'build'));
}

/** Newest first, the first `SHOWN`. */
export function newestStudioCards(cards: readonly StudioCard[]): StudioCard[] {
  return [...cards].sort((a, b) => Date.parse(b.updatedAt ?? '') - Date.parse(a.updatedAt ?? '')).slice(0, SHOWN);
}

/** The boards this browser holds that have an app — a guest's included. */
function localStudioCards(): StudioCard[] {
  return listLocalCreationSessions()
    .filter((entry) => {
      const snapshot = readLocalCreationSession(entry.sessionId);
      return !!snapshot && sessionHasApp(snapshot.nodes);
    })
    .map((entry) => ({ key: entry.sessionId, href: studioSessionPath(entry.sessionId), title: entry.title, updatedAt: entry.updatedAt }));
}

/**
 * The visitor's APPS — every board with an app on it, opened through the Studio lens.
 *
 * What "Build it" makes is a canvas session (`startCreationSession`), so this is where
 * those land: a guest's boards from this browser, and a workspace's boards from the
 * server once the stored session is known. Each opens at `/studio/<sessionId>`, the same
 * board the canvas shows, so the home is a way back in and not only a way to start.
 */
export function useStudioApps(): StudioCard[] {
  const { authReady, hasTenant } = useAuth();
  const [cards, setCards] = useState<StudioCard[]>([]);

  useEffect(() => {
    if (!authReady) return undefined;
    let cancelled = false;
    const local = localStudioCards();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage exists only after mount.
    setCards(newestStudioCards(local));
    if (!hasTenant) return () => { cancelled = true; };
    creationSessionsApi.list('active', null, { offset: 0, limit: SERVER_PAGE })
      .then(({ sessions }) => {
        if (cancelled) return;
        const server = sessions.filter(summaryHasApp).map((session) => ({
          key: session.id, href: studioSessionPath(session.id), title: session.title, updatedAt: session.lastActivityAt,
        }));
        setCards(newestStudioCards([...local, ...server]));
      })
      .catch(() => { /* the browser's own apps still stand */ });
    return () => { cancelled = true; };
  }, [authReady, hasTenant]);

  return cards;
}

'use client';

/**
 * The left panel's SESSIONS (PRD 21 §3.2).
 *
 * "Today `Sidebar.tsx` renders `NAV_GROUPS`, so the persistent surface is a site
 * map and the person's own work appears nowhere." This is the person's own work:
 * a **New canvas** action, then **Active** (the board on the stage, with a live
 * dot) and **Recents** — the durable sessions plus any account-less draft this
 * browser still holds, because an unclaimed board is the work most at risk of
 * being lost and therefore the work that most needs to be visible.
 *
 * It reads `fetchRecentCanvases()` and `listPendingDrafts()` — the shared answers
 * to "what was I working on". The PRD recorded this step as blocked on
 * `listLocalCreationSessions()` not existing; it does exist, and the block was
 * stale — a guest's session list is complete.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { creationSessionsApi, type CreationSessionSummary } from '@/lib/builderforceApi';
import { fetchRecentCanvases, invalidateRecentCanvases, listPendingDrafts } from '@/lib/pendingWork';
import type { LocalCreationEntry } from '@/domains/canvas/infrastructure/localCanvasStore';
import { startGuestCreationSession } from '@/lib/guestPromptCapture';
import { Button } from '@/components/ui';

/** How many sessions the panel lists before deferring to the canvas library. */
const RECENT_LIMIT = 8;

/** The canvas id on screen, or null when this route is not a canvas. */
function activeCanvasId(pathname: string): string | null {
  return /^\/create\/([^/]+)/.exec(pathname)?.[1] ?? null;
}

export function SessionList({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations('sessions');
  const router = useRouter();
  const pathname = usePathname() || '';
  const { hasTenant } = useAuth();

  const [recent, setRecent] = useState<CreationSessionSummary[]>([]);
  const [drafts, setDrafts] = useState<LocalCreationEntry[]>([]);
  const [creating, setCreating] = useState(false);

  const currentId = activeCanvasId(pathname);

  useEffect(() => {
    setDrafts(listPendingDrafts());
    if (!hasTenant) return;
    // Read-through and shared with the switcher, so this is not a second request.
    void fetchRecentCanvases().then(setRecent);
  }, [hasTenant, pathname]);

  const newCanvas = useCallback(async () => {
    setCreating(true);
    const openLocal = () => {
      // No workspace: the anonymous board is still a real board — a local-first
      // one this browser holds until sign-in claims it (`pendingWork`). It used
      // to bounce to `/create`, which for a signed-out visitor was a login
      // redirect, so "New canvas" was the one control in the guest shell that
      // could not do the thing it is named after.
      onNavigate?.();
      router.push(`/create/${startGuestCreationSession('', { surface: 'brain' })}`);
    };
    if (!hasTenant) {
      openLocal();
      setCreating(false);
      return;
    }
    try {
      const created = await creationSessionsApi.create({ title: t('untitled') });
      invalidateRecentCanvases();
      onNavigate?.();
      router.push(`/create/${created.session.id}`);
    } catch {
      openLocal();
    } finally {
      setCreating(false);
    }
  }, [hasTenant, onNavigate, router, t]);

  const active = recent.find((session) => session.id === currentId)
    ?? drafts.find((draft) => draft.sessionId === currentId);
  const activeTitle = active
    ? ('title' in active ? active.title : undefined) ?? t('untitled')
    : null;

  const rest = [
    ...drafts
      .filter((draft) => draft.sessionId !== currentId)
      .map((draft) => ({ id: draft.sessionId, title: draft.title || t('untitled'), draft: true })),
    ...recent
      .filter((session) => session.id !== currentId)
      .map((session) => ({ id: session.id, title: session.title || t('untitled'), draft: false })),
  ].slice(0, RECENT_LIMIT);

  return (
    <div className="nav-sessions">
      <Button variant="primary" size="sm" block loading={creating} onClick={newCanvas}>
        {t('newCanvas')}
      </Button>

      {activeTitle != null && (
        <>
          <div className="ui-eyebrow nav-sessions__label">
            <span className="nav-sessions__live" aria-hidden="true" />
            {t('active')}
          </div>
          <span className="nav-item active nav-sessions__item" aria-current="page">
            <span className="nav-item-label">{activeTitle}</span>
          </span>
        </>
      )}

      {rest.length > 0 && (
        <div className="nav-sessions__recents">
          <div className="ui-eyebrow nav-sessions__label">{t('recents')}</div>
          <div className="nav-sessions__recent-list">
            {rest.map((entry) => (
              <Link
                key={entry.id}
                href={`/create/${entry.id}`}
                className="nav-item nav-sessions__item"
                onClick={onNavigate}
                // An unclaimed draft is explicitly marked: it lives in this browser
                // only, and saying so is the difference between "I'll get to it" and
                // losing it.
                title={entry.draft ? t('draftHint') : undefined}
              >
                <span className="nav-item-label">{entry.title}</span>
                {entry.draft && <span className="nav-sessions__draft">{t('draft')}</span>}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default SessionList;

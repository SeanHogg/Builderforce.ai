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
 *
 * When a Project is scoped in the TopBar, Recents filters to it: sessions tied
 * to that project (directly, or via a tied folder) plus a separate "Unfiled"
 * bucket for anything not yet organized — nothing disappears just because it
 * hasn't been filed. "+ New canvas" is a {@link SplitButton}: the primary
 * action is unchanged, and its caret opens {@link SessionManagePanel} for
 * organizing sessions into folders and tying them to a Project.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import { creationSessionsApi, type CreationSessionSummary } from '@/lib/builderforceApi';
import { fetchRecentCanvases, invalidateRecentCanvases, listPendingDrafts } from '@/lib/pendingWork';
import type { LocalCreationEntry } from '@/domains/canvas/infrastructure/localCanvasStore';
import { startGuestCreationSession } from '@/lib/guestPromptCapture';
import { SplitButton } from '@/components/ui';
import { menuItemStyle } from '@/components/workspace/MenuSurface';
import { SessionManagePanel } from '@/components/session-management/SessionManagePanel';

/** How many sessions the panel lists before deferring to the canvas library. */
const RECENT_LIMIT = 8;

/** The canvas id on screen, or null when this route is not a canvas. */
function activeCanvasId(pathname: string): string | null {
  return /^\/create\/([^/]+)/.exec(pathname)?.[1] ?? null;
}

interface RecentEntry {
  id: string;
  title: string;
  draft: boolean;
  /** Tied to the currently scoped Project — only meaningful when one is scoped. */
  tied: boolean;
}

export function SessionList({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations('sessions');
  const tc = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname() || '';
  const { hasTenant } = useAuth();
  // Optional variant: SessionList can mount in shells without a project scope
  // provider, same as TenantProjectSwitcher — it degrades to unfiltered.
  const projectScope = useOptionalProjectScope();
  const currentProjectId = projectScope?.currentProjectId ?? null;

  const [recent, setRecent] = useState<CreationSessionSummary[]>([]);
  const [drafts, setDrafts] = useState<LocalCreationEntry[]>([]);
  const [creating, setCreating] = useState(false);
  const [managePanelOpen, setManagePanelOpen] = useState(false);

  const currentId = activeCanvasId(pathname);

  useEffect(() => {
    setDrafts(listPendingDrafts());
    if (!hasTenant) return;
    // Read-through and shared with the switcher, so this is not a second request.
    void fetchRecentCanvases(currentProjectId).then(setRecent);
  }, [hasTenant, pathname, currentProjectId]);

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
      const created = await creationSessionsApi.create({
        title: t('untitled'),
        // Scoped to a project → the new board is born tied to it, so it shows
        // up under "Tied to this project" without an extra manual step.
        projectIds: currentProjectId != null ? [currentProjectId] : undefined,
      });
      invalidateRecentCanvases();
      onNavigate?.();
      router.push(`/create/${created.session.id}`);
    } catch {
      openLocal();
    } finally {
      setCreating(false);
    }
  }, [hasTenant, onNavigate, router, t, currentProjectId]);

  const active = recent.find((session) => session.id === currentId)
    ?? drafts.find((draft) => draft.sessionId === currentId);
  const activeTitle = active
    ? ('title' in active ? active.title : undefined) ?? t('untitled')
    : null;

  const rest: RecentEntry[] = [
    ...drafts
      .filter((draft) => draft.sessionId !== currentId)
      .map((draft) => ({ id: draft.sessionId, title: draft.title || t('untitled'), draft: true, tied: false })),
    ...recent
      .filter((session) => session.id !== currentId)
      .map((session) => ({
        id: session.id,
        title: session.title || t('untitled'),
        draft: false,
        tied: currentProjectId != null
          && ((session.projectIds ?? []).includes(currentProjectId) || session.folderProjectId === currentProjectId),
      })),
  ].slice(0, RECENT_LIMIT);

  const scoped = currentProjectId != null;
  const tied = scoped ? rest.filter((entry) => entry.tied) : [];
  const unfiled = scoped ? rest.filter((entry) => !entry.tied) : rest;

  const renderEntry = (entry: RecentEntry) => (
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
  );

  return (
    <div className="nav-sessions">
      <SplitButton
        size="sm"
        block
        loading={creating}
        primaryLabel={t('newCanvas')}
        onPrimary={newCanvas}
        menuAriaLabel={t('manageAria')}
        renderMenu={(close) => (
          <div className="ui-button-group__menu" role="menu" aria-label={t('manageAria')}>
            <button
              type="button"
              role="menuitem"
              style={menuItemStyle(false)}
              onClick={() => { close(); setManagePanelOpen(true); }}
            >
              {t('manage')}
            </button>
          </div>
        )}
      />

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

      {scoped ? (
        <>
          {tied.length > 0 && (
            <div className="nav-sessions__recents">
              <div className="ui-eyebrow nav-sessions__label">{t('tiedToProject')}</div>
              <div className="nav-sessions__recent-list">{tied.map(renderEntry)}</div>
            </div>
          )}
          {unfiled.length > 0 && (
            <div className="nav-sessions__recents">
              <div className="ui-eyebrow nav-sessions__label">{tc('unfiled')}</div>
              <div className="nav-sessions__recent-list">{unfiled.map(renderEntry)}</div>
            </div>
          )}
        </>
      ) : rest.length > 0 && (
        <div className="nav-sessions__recents">
          <div className="ui-eyebrow nav-sessions__label">{t('recents')}</div>
          <div className="nav-sessions__recent-list">{rest.map(renderEntry)}</div>
        </div>
      )}

      <SessionManagePanel open={managePanelOpen} onClose={() => { setManagePanelOpen(false); invalidateRecentCanvases(); void fetchRecentCanvases(currentProjectId).then(setRecent); }} />
    </div>
  );
}

export default SessionList;

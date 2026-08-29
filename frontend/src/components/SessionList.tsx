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

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import { creationSessionsApi, type CreationSessionSummary } from '@/lib/builderforceApi';
import { fetchRecentCanvases, invalidateRecentCanvases, listPendingDrafts } from '@/lib/pendingWork';
import { updateLocalCreationSession, type LocalCreationEntry } from '@/domains/canvas/infrastructure/localCanvasStore';
import { CanvasSyncBadge } from '@/components/canvas/CanvasSyncBadge';
import { startGuestCreationSession } from '@/lib/guestPromptCapture';
import { SplitButton } from '@/components/ui';
import { menuItemStyle } from '@/components/workspace/MenuSurface';
import { SessionManagePanel } from '@/components/session-management/SessionManagePanel';
import { usePointerResize } from '@/lib/usePointerResize';
import {
  SESSION_LIST_MAX_HEIGHT,
  SESSION_LIST_MIN_HEIGHT,
  clampSessionListHeight,
  readSessionListHeight,
  writeSessionListHeight,
} from '@/lib/sessionListPreferences';

/** How far one arrow-key press resizes the panel. */
const RESIZE_STEP = 24;

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
  // Null keeps the default 42%-of-rail height (globals.css) until a drag sets
  // an explicit px value. Seeded from a stored preference, or — the first
  // time this browser sees the panel — from its own rendered height, so the
  // very first drag starts from where the panel already visually is rather
  // than snapping to an arbitrary constant.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const stored = readSessionListHeight();
    if (stored != null) { setHeight(stored); return; }
    const measured = scrollRef.current?.getBoundingClientRect().height;
    if (measured) setHeight(clampSessionListHeight(measured));
  }, []);
  const resize = usePointerResize({
    axis: 'y',
    value: height ?? SESSION_LIST_MIN_HEIGHT,
    step: RESIZE_STEP,
    clamp: clampSessionListHeight,
    onChange: (next, settled) => {
      setHeight(next);
      if (settled) writeSessionListHeight(next);
    },
  });

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

  const activeSession = recent.find((session) => session.id === currentId);
  const activeDraft = activeSession ? undefined : drafts.find((draft) => draft.sessionId === currentId);
  const active = activeSession ?? activeDraft;
  const activeTitle = active
    ? ('title' in active ? active.title : undefined) ?? t('untitled')
    : null;

  // Where a canvas's name is renamed now that the canvas itself no longer carries an
  // editable title — this is the ONE place both the display and the edit live, so it
  // cannot say one name while a stale in-flight edit says another.
  const [titleDraft, setTitleDraft] = useState('');
  useEffect(() => { if (activeTitle != null) setTitleDraft(activeTitle); }, [currentId, activeTitle]);
  const commitTitle = () => {
    if (!currentId) return;
    const value = titleDraft.trim();
    if (!value) { setTitleDraft(activeTitle ?? ''); return; }
    if (activeDraft) {
      updateLocalCreationSession(currentId, { title: value });
      setDrafts(listPendingDrafts());
      return;
    }
    if (activeSession && value !== activeSession.title) {
      setRecent((prev) => prev.map((session) => (session.id === currentId ? { ...session, title: value } : session)));
      void creationSessionsApi.update(currentId, { title: value })
        .then(() => invalidateRecentCanvases())
        .catch(() => setTitleDraft(activeSession.title));
    }
  };

  const allEntries: RecentEntry[] = [
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
  ];

  const scoped = currentProjectId != null;
  // Each bucket gets its own RECENT_LIMIT budget rather than splitting one
  // shared slice of the combined list — a project with more than RECENT_LIMIT
  // unfiled sessions used to be able to crowd every tied one out of the slice
  // before "tied" was ever checked.
  const tiedAll = scoped ? allEntries.filter((entry) => entry.tied) : [];
  const unfiledAll = scoped ? allEntries.filter((entry) => !entry.tied) : allEntries;
  const tied = tiedAll.slice(0, RECENT_LIMIT);
  const unfiled = unfiledAll.slice(0, RECENT_LIMIT);

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
      <div
        ref={scrollRef}
        className="nav-sessions__scroll"
        style={height != null ? ({ '--nav-sessions-height': `${height}px` } as CSSProperties) : undefined}
      >
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
              <span className="nav-sessions__count">(1)</span>
            </div>
            <span className="nav-item active nav-sessions__item" aria-current="page">
              <input
                className="nav-item-label nav-sessions__title-input"
                aria-label={t('renameAria')}
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={commitTitle}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') (event.currentTarget as HTMLInputElement).blur();
                  else if (event.key === 'Escape') setTitleDraft(activeTitle ?? '');
                }}
              />
              <CanvasSyncBadge sessionId={currentId} />
            </span>
          </>
        )}

        {scoped ? (
          <>
            {tied.length > 0 && (
              <div className="nav-sessions__recents">
                <div className="ui-eyebrow nav-sessions__label">
                  {t('tiedToProject')}
                  <span className="nav-sessions__count">({tiedAll.length})</span>
                </div>
                <div className="nav-sessions__recent-list">{tied.map(renderEntry)}</div>
              </div>
            )}
            {unfiled.length > 0 && (
              <div className="nav-sessions__recents">
                <div className="ui-eyebrow nav-sessions__label">
                  {tc('unfiled')}
                  <span className="nav-sessions__count">({unfiledAll.length})</span>
                </div>
                <div className="nav-sessions__recent-list">{unfiled.map(renderEntry)}</div>
              </div>
            )}
          </>
        ) : unfiled.length > 0 && (
          <div className="nav-sessions__recents">
            <div className="ui-eyebrow nav-sessions__label">
              {t('recents')}
              <span className="nav-sessions__count">({unfiledAll.length})</span>
            </div>
            <div className="nav-sessions__recent-list">{unfiled.map(renderEntry)}</div>
          </div>
        )}
      </div>

      <div
        className="nav-sessions__resizer"
        role="separator"
        aria-orientation="horizontal"
        aria-label={t('resizeAria')}
        aria-valuenow={height ?? undefined}
        aria-valuemin={SESSION_LIST_MIN_HEIGHT}
        aria-valuemax={SESSION_LIST_MAX_HEIGHT}
        tabIndex={0}
        {...resize}
      />

      <SessionManagePanel open={managePanelOpen} onClose={() => { setManagePanelOpen(false); invalidateRecentCanvases(); void fetchRecentCanvases(currentProjectId).then(setRecent); }} />
    </div>
  );
}

export default SessionList;

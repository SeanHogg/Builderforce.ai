'use client';

import { Icon } from '@/components/ui/Icon';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { useDismissable } from '@/lib/useDismissable';
import { creationSessionsApi, type CreationSessionSummary } from '@/lib/builderforceApi';
import { fetchRecentCanvases, invalidateRecentCanvases, listPendingDrafts, readLastCanvas } from '@/lib/pendingWork';
import type { LocalCreationEntry } from '@/domains/canvas/infrastructure/localCanvasStore';
import { MenuDivider, MenuItemMeta, MenuScroll, MenuSectionLabel, MenuSurface, menuItemStyle } from './MenuSurface';

/** How many recent canvases the menu offers before deferring to the library. */
const RECENT_LIMIT = 8;

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }} aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

/** The canvas id currently on screen, or null when this route is not a canvas. */
function activeCanvasId(pathname: string): string | null {
  return /^\/create\/([^/]+)/.exec(pathname)?.[1] ?? null;
}

/**
 * "How do I get back to what I was working on?" — the one answer, present on
 * every route.
 *
 * Before this, a returning user's canvases were reachable only through a sub-tab
 * of a panel positioned ~1,160px down a pannable infinite board, and the single
 * nav item named after the work (`✦ Create`) redirected to the dashboard. So the
 * product had no findable route back to the thing the person came to continue.
 *
 * Unclaimed drafts are pinned ABOVE saved canvases deliberately: an account-less
 * board is the work most at risk of being lost, so it is the work that most
 * needs to be visible. It self-gates — no tenant, no switcher.
 */
export function CanvasSwitcher() {
  const t = useTranslations('canvasSwitcher');
  const router = useRouter();
  const pathname = usePathname() || '';
  const { hasTenant } = useAuth();
  const { open, toggle, close, ref } = useDismissable<HTMLDivElement>();

  const [recent, setRecent] = useState<CreationSessionSummary[]>([]);
  const [drafts, setDrafts] = useState<LocalCreationEntry[]>([]);
  const [creating, setCreating] = useState(false);

  const currentId = activeCanvasId(pathname);

  // Load on OPEN rather than on mount: the switcher renders on every route, and
  // a list nobody looked at is a request nobody needed. `fetchRecentCanvases`
  // is read-through, so re-opening inside its window costs nothing.
  useEffect(() => {
    if (!open || !hasTenant) return;
    let active = true;
    void fetchRecentCanvases().then((sessions) => { if (active) setRecent(sessions); });
    setDrafts(listPendingDrafts());
    return () => { active = false; };
  }, [open, hasTenant]);

  const currentLabel = currentId
    ? recent.find((session) => session.id === currentId)?.title
      ?? drafts.find((draft) => draft.sessionId === currentId)?.title
      ?? t('untitled')
    : readLastCanvas()?.title ?? t('canvases');

  const createCanvas = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const created = await creationSessionsApi.create({ title: t('untitled') });
      invalidateRecentCanvases();
      close();
      router.push(`/create/${created.session.id}`);
    } catch {
      // Server unavailable — `/create/new` owns the local-first fallback, so send
      // the person there rather than inventing a second copy of that decision.
      close();
      router.push('/create/new');
    } finally {
      setCreating(false);
    }
  }, [close, creating, router, t]);

  if (!hasTenant) return null;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="tenant-chip"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('title', { name: currentLabel })}
        style={{ cursor: 'pointer', border: 'none', font: 'inherit' }}
      >
        <span aria-hidden="true"><Icon source="✦" size="1em" /></span>
        <span className="tenant-chip__project" style={{ fontWeight: 600 }}>{currentLabel}</span>
        <Chevron />
      </button>

      {open && (
        <MenuSurface label={t('selectAria')}>
          {drafts.length > 0 && (
            <>
              <MenuSectionLabel>{t('unsavedLabel')}</MenuSectionLabel>
              <MenuScroll>
                {drafts.map((draft) => (
                  <Link
                    key={draft.sessionId}
                    href={`/create/${draft.sessionId}`}
                    role="menuitem"
                    onClick={close}
                    style={menuItemStyle(draft.sessionId === currentId)}
                  >
                    {draft.title || t('untitled')}
                    <MenuItemMeta>{t('unsavedHint')}</MenuItemMeta>
                  </Link>
                ))}
              </MenuScroll>
              <MenuDivider />
            </>
          )}

          <MenuSectionLabel>{t('recentLabel')}</MenuSectionLabel>
          <MenuScroll>
            {recent.slice(0, RECENT_LIMIT).map((session) => (
              <Link
                key={session.id}
                href={`/create/${session.id}`}
                role="menuitem"
                onClick={close}
                style={menuItemStyle(session.id === currentId)}
              >
                {session.title || t('untitled')}
              </Link>
            ))}
            {recent.length === 0 && (
              <div style={{ padding: '7px 10px', fontSize: 13, color: 'var(--text-muted)' }}>{t('empty')}</div>
            )}
          </MenuScroll>

          <MenuDivider />
          <button type="button" role="menuitem" onClick={() => void createCanvas()} disabled={creating} style={menuItemStyle(false)}>
            {creating ? t('creating') : t('newCanvas')}
          </button>
          <Link href="/create" role="menuitem" onClick={close} style={menuItemStyle(false)}>
            {t('allCanvases')}
          </Link>
        </MenuSurface>
      )}
    </div>
  );
}

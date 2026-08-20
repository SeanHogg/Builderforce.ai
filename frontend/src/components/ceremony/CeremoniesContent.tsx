'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useProjectScope } from '@/lib/ProjectScopeContext';
import { PokerSurface } from '@/components/agile/PokerSurface';
import { RetroSurface } from '@/components/agile/RetroSurface';
import { CeremonyStage, type CeremonyMode } from '@/components/ceremony/CeremonyStage';
import { CeremonySchedulesPanel } from '@/components/ceremony/CeremonySchedulesPanel';
import { CeremonyHistoryPanel } from '@/components/ceremony/CeremonyHistoryPanel';

/**
 * The Ceremonies surface, scoped to a project. Three views:
 *
 *  - "live"      — the standup / planning round-table (CeremonyStage). Extracted
 *                  from the old standalone /ceremonies page so it can render as
 *                  the "Ceremonies" tab of Projects (its conceptual home).
 *  - "history"   — the ceremonies that have already run (migration 0365): when,
 *                  who attended, who was missing, what changed hands. Sessions were
 *                  being recorded and then were unreadable — the live view only ever
 *                  showed the ACTIVE session — so a ceremony the manager conducted
 *                  unattended would have happened unobservably.
 *  - "schedules" — the cadence layer (migration 0349): recurring standups /
 *                  plannings the cron sweep opens by itself, roster pre-seeded.
 *                  Reads are member-level; writes are MANAGER+.
 *  - "retro"     — retrospectives, and
 *  - "poker"     — planning poker. Both are ceremonies a TEAM performs, and both had
 *                  no home in the product at all: they existed only behind
 *                  `/embed/<view>`, which is the third-party embed boundary, so a
 *                  linked chat pointing at one had nowhere to open. They are
 *                  workspace-wide (neither table carries a projectId), so they render
 *                  ABOVE the project gate below rather than behind it.
 *
 * The project is chosen via the global TopBar tenant→project selector
 * ({@link useProjectScope}) — a ceremony is inherently per-project, so the
 * all-projects view prompts to pick one. The page-level auth guard + container
 * live in the Projects page that hosts it.
 */

type CeremonyView = 'live' | 'history' | 'schedules' | 'retro' | 'poker';

/** The views that need a project. The two ceremonies are workspace-wide. */
const PROJECT_SCOPED: ReadonlySet<CeremonyView> = new Set<CeremonyView>(['live', 'history', 'schedules']);

const VIEWS: readonly CeremonyView[] = ['live', 'history', 'schedules', 'retro', 'poker'];

/** Tab label key per view — keeps the tablist a single map, not a nested ternary. */
const VIEW_LABEL: Record<CeremonyView, string> = {
  live: 'viewLive',
  history: 'viewHistory',
  schedules: 'viewSchedules',
  retro: 'viewRetro',
  poker: 'viewPoker',
};

export function CeremoniesContent() {
  const t = useTranslations('ceremonies');
  const { currentProjectId } = useProjectScope();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<CeremonyMode>('standup');
  const [view, setView] = useState<CeremonyView>('live');

  // Deep link from a linked chat's "open" — `?ceremony=retro&session=<uuid>` selects
  // the view AND the session, so a chat tied to a retro lands on that retro rather
  // than on a list the reader then has to search.
  const ceremonyParam = searchParams.get('ceremony');
  const sessionParam = searchParams.get('session');
  useEffect(() => {
    if (ceremonyParam === 'retro' || ceremonyParam === 'poker') setView(ceremonyParam);
  }, [ceremonyParam]);

  // The tablist renders in BOTH branches below (with and without a project), so it is
  // built once here — a second copy is exactly how the two would drift.
  const viewSwitch = (
    <div
      role="tablist"
      aria-label={t('viewSwitchLabel')}
      style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}
    >
      {VIEWS.map((v) => {
        const active = view === v;
        return (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setView(v)}
            style={{
              minHeight: 40,
              padding: '8px 14px',
              borderRadius: 'var(--radius-md)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              background: active ? 'var(--bg-elevated)' : 'transparent',
              color: active ? 'var(--text-primary)' : 'var(--text-muted)',
              border: `1px solid ${active ? 'var(--border)' : 'transparent'}`,
            }}
          >
            {t(VIEW_LABEL[v])}
          </button>
        );
      })}
    </div>
  );

  // The project gate applies ONLY to the project-scoped views. A retro or an estimation
  // session belongs to the WORKSPACE (neither table carries a projectId), so gating it
  // behind a project selection would hide a surface that has no project to select — and
  // the switch stays visible either way so the two ceremonies remain reachable.
  const needsProject = currentProjectId == null && PROJECT_SCOPED.has(view);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 180px)', minHeight: 360 }}>
      {/* View switch — wraps rather than overflowing on narrow viewports; each
          control keeps a tap-friendly height. */}
      {viewSwitch}

      {needsProject ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('selectProject')}</div>
      ) : (
        /* Only the live round table manages its own height; every scrolling panel gets
           the overflow container so long lists scroll inside the tab, not the page. */
        <div style={{ flex: 1, minHeight: 0, ...(view === 'live' ? {} : { overflowY: 'auto' }) }}>
          {view === 'live' && currentProjectId != null && (
            <CeremonyStage projectId={currentProjectId} mode={mode} onModeChange={setMode} />
          )}
          {view === 'history' && currentProjectId != null && <CeremonyHistoryPanel projectId={currentProjectId} />}
          {view === 'schedules' && currentProjectId != null && <CeremonySchedulesPanel projectId={currentProjectId} />}
          {view === 'retro' && <RetroSurface initialRetroId={ceremonyParam === 'retro' ? sessionParam : null} />}
          {view === 'poker' && <PokerSurface initialSessionId={ceremonyParam === 'poker' ? sessionParam : null} />}
        </div>
      )}
    </div>
  );
}

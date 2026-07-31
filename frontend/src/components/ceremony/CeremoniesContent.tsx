'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useProjectScope } from '@/lib/ProjectScopeContext';
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
 *
 * The project is chosen via the global TopBar tenant→project selector
 * ({@link useProjectScope}) — a ceremony is inherently per-project, so the
 * all-projects view prompts to pick one. The page-level auth guard + container
 * live in the Projects page that hosts it.
 */

type CeremonyView = 'live' | 'history' | 'schedules';

/** Tab label key per view — keeps the tablist a single map, not a nested ternary. */
const VIEW_LABEL: Record<CeremonyView, string> = {
  live: 'viewLive',
  history: 'viewHistory',
  schedules: 'viewSchedules',
};

export function CeremoniesContent() {
  const t = useTranslations('ceremonies');
  const { currentProjectId } = useProjectScope();
  const [mode, setMode] = useState<CeremonyMode>('standup');
  const [view, setView] = useState<CeremonyView>('live');

  if (currentProjectId == null) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 180px)', minHeight: 360 }}>
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('selectProject')}</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 180px)', minHeight: 360 }}>
      {/* View switch — wraps rather than overflowing on narrow viewports; each
          control keeps a tap-friendly height. */}
      <div
        role="tablist"
        aria-label={t('viewSwitchLabel')}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}
      >
        {(['live', 'history', 'schedules'] as const).map((v) => {
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
                borderRadius: 8,
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

      {/* Only the live round table manages its own height; the two scrolling panels get
          the overflow container so long lists scroll inside the tab, not the page. */}
      <div style={{ flex: 1, minHeight: 0, ...(view === 'live' ? {} : { overflowY: 'auto' }) }}>
        {view === 'live' && (
          <CeremonyStage projectId={currentProjectId} mode={mode} onModeChange={setMode} />
        )}
        {view === 'history' && <CeremonyHistoryPanel projectId={currentProjectId} />}
        {view === 'schedules' && <CeremonySchedulesPanel projectId={currentProjectId} />}
      </div>
    </div>
  );
}

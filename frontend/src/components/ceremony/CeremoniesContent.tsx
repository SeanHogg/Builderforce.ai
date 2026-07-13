'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useProjectScope } from '@/lib/ProjectScopeContext';
import { CeremonyStage, type CeremonyMode } from '@/components/ceremony/CeremonyStage';

/**
 * The live standup / planning round-table, scoped to a project. Extracted from
 * the old standalone /ceremonies page so it can render as the "Ceremonies" tab
 * of Projects (its conceptual home). The project is chosen via the global
 * TopBar tenant→project selector ({@link useProjectScope}) — a ceremony is
 * inherently per-project, so the all-projects view prompts to pick one. The
 * page-level auth guard + container live in the Projects page that hosts it.
 */
export function CeremoniesContent() {
  const t = useTranslations('ceremonies');
  const { currentProjectId } = useProjectScope();
  const [mode, setMode] = useState<CeremonyMode>('standup');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 180px)', minHeight: 360 }}>
      {currentProjectId == null ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('selectProject')}</div>
      ) : (
        <div style={{ flex: 1, minHeight: 0 }}>
          <CeremonyStage projectId={currentProjectId} mode={mode} onModeChange={setMode} />
        </div>
      )}
    </div>
  );
}

'use client';

import { useTranslations } from 'next-intl';
import type { Project } from '@/lib/types';

export interface RunDiagnosticsButtonProps {
  project: Project;
  /** Open the project panel on the Diagnostics tab. */
  onOpen: (project: Project) => void;
}

/**
 * The diagnostics entry point on a project card / row. Opens the project panel's
 * Diagnostics tab, where every diagnostic (including architecture analysis) is
 * run and its results viewed. Shared by the card and the table so behavior can't
 * drift.
 */
export function RunDiagnosticsButton({ project, onOpen }: RunDiagnosticsButtonProps) {
  const t = useTranslations('projectDiagnostics');
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpen(project); }}
      style={{
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--coral-bright)',
        background: 'transparent',
        border: '1px solid var(--coral-bright)',
        borderRadius: 8,
        padding: '4px 10px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {t('runDiagnostics')}
    </button>
  );
}

'use client';

/**
 * The Workspace tab: three shortcuts into the tabs where work actually starts,
 * and the door out to the project's Builder canvas.
 *
 * It takes `onOpenTab` rather than reaching for the panel's state, which is what
 * lets it be tested — and rendered anywhere else — without a panel around it.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { Project } from '@/lib/types';
import { cardStyle, tabGridStyle } from './panelStyles';
import type { ProjectPanelTab } from './projectPanelTabs';

const actionStyle: React.CSSProperties = {
  padding: '8px 14px',
  fontSize: 'var(--font-size-small)',
  fontWeight: 600,
  background: 'var(--surface-interactive)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
};

/** Which tab each shortcut opens. Data, so a fourth shortcut is a row, not a branch. */
const SHORTCUTS: ReadonlyArray<{ tab: ProjectPanelTab; key: string }> = [
  { tab: 'taskMgmt', key: 'createTask' },
  { tab: 'brainChat', key: 'planWithBrain' },
  { tab: 'prds', key: 'draftPrd' },
];

export function ProjectWorkspaceTab({
  project,
  onOpenTab,
}: {
  project: Project;
  onOpenTab: (tab: ProjectPanelTab) => void;
}) {
  const t = useTranslations('projectDetails');

  return (
    <div style={tabGridStyle}>
      <div style={cardStyle}>
        <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 'var(--font-size-body)' }}>{t('workspaceActions')}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {SHORTCUTS.map(({ tab, key }) => (
            <button key={tab} type="button" onClick={() => onOpenTab(tab)} style={actionStyle}>
              {t(key)}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 12, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>
          {t('brainHint')}
        </div>
      </div>

      {/* Open the project's Builder workspace on Canvas. */}
      <div style={cardStyle}>
        <div style={{ fontWeight: 600, marginBottom: 10 }}>{t('workspaceTitle')}</div>
        <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('workspaceDesc')}</p>
        <Link
          href={`/create/build/${project.publicId ?? project.id}`}
          style={{ fontSize: 'var(--font-size-small)', color: 'var(--coral-bright)', marginTop: 8, display: 'inline-block' }}
        >
          {t('openInBuilder')} →
        </Link>
      </div>
    </div>
  );
}

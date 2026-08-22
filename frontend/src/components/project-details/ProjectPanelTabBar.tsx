'use client';

/**
 * The drawer's tab strip. It renders `PROJECT_PANEL_TABS` and nothing else — the
 * set of tabs is data, so adding one never touches this file.
 */
import { useTranslations } from 'next-intl';
import { PROJECT_PANEL_TABS, type ProjectPanelTab } from './projectPanelTabs';

export function ProjectPanelTabBar({
  active,
  onSelect,
}: {
  active: ProjectPanelTab;
  onSelect: (tab: ProjectPanelTab) => void;
}) {
  const t = useTranslations('projectDetails');

  return (
    <div
      role="tablist"
      aria-label={t('tabsAria')}
      style={{
        display: 'flex',
        gap: 2,
        padding: '0 20px',
        borderBottom: '1px solid var(--border-subtle)',
        overflowX: 'auto',
        flexShrink: 0,
      }}
    >
      {PROJECT_PANEL_TABS.map(({ id, key }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={active === id}
          onClick={() => onSelect(id)}
          style={{
            padding: '12px 14px',
            fontSize: 'var(--font-size-small)',
            fontWeight: 600,
            color: active === id ? 'var(--coral-bright)' : 'var(--text-secondary)',
            background: 'none',
            border: 'none',
            borderBottom: active === id ? '2px solid var(--coral-bright)' : '2px solid transparent',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            marginBottom: -1,
          }}
        >
          {t(key)}
        </button>
      ))}
    </div>
  );
}

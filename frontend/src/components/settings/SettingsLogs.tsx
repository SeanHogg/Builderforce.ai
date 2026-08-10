'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { DestinationIndex, type IndexItem } from '@/components/shell/DestinationIndex';
import { ActiveRunsPanel } from '@/components/ActiveRunsPanel';
import { ObservabilityContent } from '@/components/ObservabilityContent';
import AuditLogsContent from '@/app/logs/page';

type LogView = 'runtime' | 'audit';

/** Workspace-wide logging surfaces consolidated under Settings. */
export default function SettingsLogs() {
  const t = useTranslations('settings');
  const requested = useSearchParams().get('log');
  const view: LogView = requested === 'audit' ? 'audit' : 'runtime';

  // Built here rather than at module scope: the labels are user-facing copy and
  // have to come from the catalogs, which only exist inside the component.
  const logTabs: IndexItem[] = [
    { id: 'runtime', label: t('logsRuntimeTab'), icon: '💻', href: '/settings?sub=logs' },
    { id: 'audit', label: t('logsAuditTab'), icon: '📋', href: '/settings?sub=logs&log=audit' },
  ];

  return (
    <div>
      <DestinationIndex items={logTabs} activeId={view} ariaLabel={t('logSectionsLabel')} />

      {view === 'audit' ? (
        <AuditLogsContent />
      ) : (
        <>
          <div style={{ marginBottom: 24 }}>
            <ActiveRunsPanel />
          </div>
          <ObservabilityContent initialView="logs" />
        </>
      )}
    </div>
  );
}

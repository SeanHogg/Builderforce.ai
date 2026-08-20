'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { DestinationIndex, type IndexItem } from '@/components/shell/DestinationIndex';
import { ActiveRunsPanel } from '@/components/ActiveRunsPanel';
import { ObservabilityContent } from '@/components/ObservabilityContent';
import { AuditTrailPanel } from '@/components/contributors/AuditTrailPanel';

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

      {/* ONE audit surface, mounted twice. `/app/logs/page.tsx` became a redirect
          when logging was consolidated here, and this tab kept importing it — so
          choosing "Audit" rendered a component that redirects to this very URL.
          `AuditTrailPanel` is the tenant-wide activity/audit trail the Performance
          tab already shows; rebuilding a second one here is what the DRY rule
          forbids, and it is the reason the first copy could rot unnoticed. */}
      {view === 'audit' ? (
        <AuditTrailPanel />
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

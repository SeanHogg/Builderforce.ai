'use client';

import { useSearchParams } from 'next/navigation';
import PillTabs, { type PillTab } from '@/components/PillTabs';
import { ActiveRunsPanel } from '@/components/ActiveRunsPanel';
import { ObservabilityContent } from '@/components/ObservabilityContent';
import AuditLogsContent from '@/app/logs/page';

type LogView = 'runtime' | 'audit';

const LOG_TABS: PillTab[] = [
  { id: 'runtime', label: 'Runtime & timeline', icon: '💻', href: '/settings?sub=logs' },
  { id: 'audit', label: 'Audit log', icon: '📋', href: '/settings?sub=logs&log=audit' },
];

/** Workspace-wide logging surfaces consolidated under Settings. */
export default function SettingsLogs() {
  const requested = useSearchParams().get('log');
  const view: LogView = requested === 'audit' ? 'audit' : 'runtime';

  return (
    <div>
      <PillTabs tabs={LOG_TABS} activeId={view} ariaLabel="Log sections" />

      {view === 'audit' ? (
        <AuditLogsContent embedded />
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

/**
 * Admin ▸ Growth ▸ Visitors — the ONE insights home.
 *
 * Flow and leads used to be sibling Growth views. They are two readings of the
 * same anonymous funnel, so they live on one page and open the same RecordingPanel.
 * The window control and refresh sit here because both halves share them.
 */

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi, type AdminGuestSession, type AdminGuestSessionsPage, type AdminVisitorFlow } from '@/lib/adminApi';
import { AdminLoading, AdminPanelHeader, useAdminData } from '@/components/admin/adminShared';
import { FlowView } from '@/components/admin/visitors/FlowView';
import { LeadsView } from '@/components/admin/visitors/LeadsView';
import { RecordingPanel, type RecordingPanelTabId } from '@/components/visitors/RecordingPanel';

const WINDOWS = [7, 30, 90] as const;

export default function InsightsPanelHost() {
  const t = useTranslations('admin.insights');
  const tFlow = useTranslations('admin.visitorFlow');
  const [days, setDays] = useState<number>(30);
  const [openVisitorId, setOpenVisitorId] = useState<string | null>(null);
  const [openSession, setOpenSession] = useState<AdminGuestSession | null>(null);
  const [tab, setTab] = useState<RecordingPanelTabId>('journey');

  const {
    data: flowData,
    loading: flowLoading,
    error: flowError,
    reload: reloadFlow,
  } = useAdminData<AdminVisitorFlow>(() => adminApi.visitorFlow(days), [days]);
  const {
    data: leadsData,
    loading: leadsLoading,
    error: leadsError,
    reload: reloadLeads,
  } = useAdminData<AdminGuestSessionsPage>(() => adminApi.guestSessions());

  const refresh = useCallback(() => {
    void reloadFlow();
    void reloadLeads();
  }, [reloadFlow, reloadLeads]);

  const openVisitor = useCallback((visitorId: string) => {
    const match = leadsData?.sessions.find((session) => session.visitorId === visitorId) ?? null;
    setOpenVisitorId(visitorId);
    setOpenSession(match);
    setTab('journey');
  }, [leadsData]);

  const openLead = useCallback((session: AdminGuestSession) => {
    setOpenVisitorId(session.visitorId);
    setOpenSession(session);
    setTab('lead');
  }, []);

  const closeRecording = useCallback(() => {
    setOpenVisitorId(null);
    setOpenSession(null);
  }, []);

  if ((flowLoading && !flowData) && (leadsLoading && !leadsData)) return <AdminLoading />;

  return (
    <div>
      <AdminPanelHeader
        title={t('title')}
        subtitle={t('subtitle')}
        onRefresh={refresh}
        actions={
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {WINDOWS.map((window) => (
              <button
                key={window}
                type="button"
                className={window === days ? 'btn-secondary' : 'btn-ghost'}
                aria-pressed={window === days}
                onClick={() => setDays(window)}
              >
                {tFlow('window', { days: window })}
              </button>
            ))}
          </div>
        }
      />

      <FlowView
        data={flowData}
        loading={flowLoading}
        error={flowError}
        onOpenVisitor={openVisitor}
      />
      <LeadsView
        data={leadsData}
        loading={leadsLoading}
        error={leadsError}
        onOpenLead={openLead}
      />
      <RecordingPanel
        visitorId={openVisitorId}
        session={openSession}
        tab={tab}
        onTabChange={setTab}
        onClose={closeRecording}
        onErased={reloadLeads}
      />
    </div>
  );
}

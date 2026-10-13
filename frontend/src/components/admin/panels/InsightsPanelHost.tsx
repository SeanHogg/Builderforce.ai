/**
 * Admin ▸ Growth ▸ Visitors — builderforce.ai's own anonymous funnel.
 *
 * Flow and leads read builderforce.ai's `activity_log` journey; they are two
 * readings of the same funnel, so they live on one page and open the same
 * RecordingPanel. Recordings are NOT here (PRD 33 D17: Builderforce is
 * customer #1 and reviews them in the Insights app like any workspace) — the
 * header links there, carrying the `?panel=` a legacy admin address maps to.
 */

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { resolveAdminRoute } from '@/lib/adminGroups';
import { adminApi, type AdminGuestSession, type AdminGuestSessionsPage, type AdminVisitorFlow } from '@/lib/adminApi';
import { AdminLoading, AdminPanelHeader, useAdminData } from '@/components/admin/adminShared';
import { FlowView } from '@/components/admin/visitors/FlowView';
import { LeadsView } from '@/components/admin/visitors/LeadsView';
import { RecordingPanel, type RecordingPanelTabId } from '@/components/visitors/RecordingPanel';

const WINDOWS = [7, 30, 90] as const;

export default function InsightsPanelHost() {
  const t = useTranslations('admin.insights');
  const tFlow = useTranslations('admin.visitorFlow');
  const searchParams = useSearchParams();
  const legacyPanel = resolveAdminRoute(searchParams?.get('tab') ?? '', searchParams?.get('sub') ?? '').panel;
  const insightsHref = legacyPanel ? `/apps/insights?panel=${encodeURIComponent(legacyPanel)}` : '/apps/insights';
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
            <Link href={insightsHref} className="btn-secondary">{t('openApp')}</Link>
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

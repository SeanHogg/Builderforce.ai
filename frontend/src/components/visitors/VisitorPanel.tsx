/**
 * The ONE visitor panel for Admin ▸ Growth ▸ Visitors (builderforce.ai's
 * `activity_log` journey). Journey and lead are tabs of the same panel because
 * they are two readings of the same visitor; the tabs are `VISITOR_PANEL_TABS`
 * (data, with `requires`), and the panel shares the Insights panel's width
 * memory (`insights-panel`) so a reader sizes the side panel once.
 *
 * Copy and message stay on the header, reachable from either tab; erase lives
 * in the lead body beside the data it deletes, and closes the panel when done.
 */

import { useState, type ComponentType } from 'react';
import { useTranslations } from 'next-intl';
import type { AdminGuestSession } from '@/lib/adminApi';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { BroadcastComposer } from '@/components/admin/panels/BroadcastComposer';
import { GuestSessionCopyButton } from '@/components/visitors/GuestSessionCopyButton';
import { VisitorJourneyTimeline } from '@/components/visitors/VisitorJourneyTimeline';
import { VisitorLeadDetail } from '@/components/visitors/VisitorLeadDetail';

export type VisitorPanelTabId = 'journey' | 'lead';

export interface VisitorPanelTabProps {
  visitorId: string;
  session: AdminGuestSession | null;
  onErased: () => void;
}

export interface VisitorPanelTab {
  id: VisitorPanelTabId;
  /** Full keys (several admin namespaces share this panel). */
  labelKey: string;
  titleKey: string;
  /** A fact the tab needs; a tab whose requirement is unmet is not offered. */
  requires?: 'session';
  Component: ComponentType<VisitorPanelTabProps>;
}

function JourneyTab({ visitorId }: VisitorPanelTabProps) {
  return <VisitorJourneyTimeline visitorId={visitorId} />;
}

function LeadTab({ visitorId, session, onErased }: VisitorPanelTabProps) {
  return <VisitorLeadDetail visitorId={visitorId} session={session} onErased={onErased} />;
}

export const VISITOR_PANEL_TABS: ReadonlyArray<VisitorPanelTab> = [
  {
    id: 'journey',
    labelKey: 'admin.insights.tabJourney',
    titleKey: 'admin.visitorFlow.journeyTitle',
    Component: JourneyTab,
  },
  {
    id: 'lead',
    labelKey: 'admin.insights.tabLead',
    titleKey: 'admin.sessions.drawerTitle',
    Component: LeadTab,
  },
];

const FACTS: Record<NonNullable<VisitorPanelTab['requires']>, (session: AdminGuestSession | null) => boolean> = {
  session: (session) => session != null,
};

export interface VisitorPanelProps {
  visitorId: string | null;
  session?: AdminGuestSession | null;
  tab: VisitorPanelTabId;
  onTabChange: (tab: VisitorPanelTabId) => void;
  onClose: () => void;
  onErased?: () => void;
}

export function VisitorPanel({
  visitorId,
  session = null,
  tab,
  onTabChange,
  onClose,
  onErased,
}: VisitorPanelProps) {
  const t = useTranslations();
  const tInsights = useTranslations('admin.insights');
  const tSessions = useTranslations('admin.sessions');
  const [messaging, setMessaging] = useState(false);

  if (!visitorId) return null;
  const id = visitorId;
  const tabs = VISITOR_PANEL_TABS.filter((row) => !row.requires || FACTS[row.requires](session));
  const active = tabs.find((row) => row.id === tab) ?? tabs[0];
  if (!active) return null;
  const Body = active.Component;

  const erased = () => {
    onErased?.();
    onClose();
  };

  return (
    <>
      <SlideOutPanel
        open
        onClose={onClose}
        title={t(active.titleKey)}
        crumb={tInsights('crumb')}
        width="wide"
        widthStorageKey="insights-panel"
        tabs={tabs.map((row) => ({ id: row.id, label: t(row.labelKey) }))}
        activeTabId={active.id}
        onTabChange={(next) => {
          const match = tabs.find((row) => row.id === next);
          if (match) onTabChange(match.id);
        }}
        headerActions={(
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {session && <GuestSessionCopyButton session={session} compact />}
            <button type="button" className="btn-primary" onClick={() => setMessaging(true)}>
              {tSessions('messageVisitor')}
            </button>
          </div>
        )}
      >
        <Body visitorId={id} session={session} onErased={erased} />
      </SlideOutPanel>

      {messaging && (
        <BroadcastComposer
          open
          onClose={() => setMessaging(false)}
          targetVisitorId={id}
          onSaved={() => setMessaging(false)}
        />
      )}
    </>
  );
}

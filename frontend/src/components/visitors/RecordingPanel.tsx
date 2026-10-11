/**
 * The ONE recording drawer. Journey and lead used to be two drawers on two
 * Growth views; they are now tabs of the same panel because they are two
 * readings of the same visitor. Copy / message / erase stay on the header so
 * they are reachable from either tab.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi, type AdminGuestSession } from '@/lib/adminApi';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { BroadcastComposer } from '@/components/admin/panels/BroadcastComposer';
import { useConfirm } from '@/components/ConfirmProvider';
import { useToast } from '@/components/ToastProvider';
import { GuestSessionCopyButton } from '@/components/visitors/GuestSessionCopyButton';
import { VisitorJourneyTimeline } from '@/components/visitors/VisitorJourneyTimeline';
import { VisitorLeadDetail } from '@/components/visitors/VisitorLeadDetail';

export type RecordingPanelTabId = 'journey' | 'lead';

export function RecordingPanel({
  visitorId,
  session = null,
  tab,
  onTabChange,
  onClose,
  onErased,
}: {
  visitorId: string | null;
  session?: AdminGuestSession | null;
  tab: RecordingPanelTabId;
  onTabChange: (tab: RecordingPanelTabId) => void;
  onClose: () => void;
  onErased?: () => void;
}) {
  const tInsights = useTranslations('admin.insights');
  const tSessions = useTranslations('admin.sessions');
  const tFlow = useTranslations('admin.visitorFlow');
  const confirm = useConfirm();
  const toast = useToast();
  const [messaging, setMessaging] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [eraseGen, setEraseGen] = useState(0);

  if (!visitorId) return null;
  const id = visitorId;

  async function erase() {
    if (!(await confirm({
      message: tSessions('eraseConfirm'),
      confirmLabel: tSessions('erase'),
      destructive: true,
    }))) return;
    setErasing(true);
    try {
      const count = await adminApi.forgetGuestPrompts(id);
      toast.success(tSessions('eraseDone', { count }));
      setEraseGen((n) => n + 1);
      onErased?.();
    } catch {
      toast.error(tSessions('eraseFailed'));
    } finally {
      setErasing(false);
    }
  }

  return (
    <>
      <SlideOutPanel
        open
        onClose={onClose}
        title={tab === 'journey' ? tFlow('journeyTitle') : tSessions('drawerTitle')}
        crumb={tInsights('crumb')}
        width="wide"
        widthStorageKey="visitor-recording"
        tabs={[
          { id: 'journey', label: tInsights('tabJourney') },
          { id: 'lead', label: tInsights('tabLead') },
        ]}
        activeTabId={tab}
        onTabChange={(id) => onTabChange(id === 'lead' ? 'lead' : 'journey')}
        headerActions={(
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {session && <GuestSessionCopyButton session={session} compact />}
            <button type="button" className="btn-primary" onClick={() => setMessaging(true)}>
              {tSessions('messageVisitor')}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => void erase()}
              disabled={erasing}
              aria-label={tSessions('eraseAria', { visitor: id })}
            >
              {tSessions('erase')}
            </button>
          </div>
        )}
      >
        {tab === 'journey' ? (
          <VisitorJourneyTimeline visitorId={id} />
        ) : (
          <VisitorLeadDetail visitorId={id} session={session} reloadToken={eraseGen} />
        )}
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

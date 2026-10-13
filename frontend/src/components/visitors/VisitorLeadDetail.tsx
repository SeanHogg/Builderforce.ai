/**
 * The lead body of a recording — funnel numbers, contact fields, the prompt
 * history, and the erase action. RecordingPanel owns the chrome; this owns the
 * fetch so a surface that already has a session row can pass it in without a
 * second list round-trip. Erase lives here, beside the data it deletes; after
 * it succeeds the host is told (`onErased`) and closes the panel, because there
 * is nothing left to show.
 */

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi, type AdminGuestPrompt, type AdminGuestSession } from '@/lib/adminApi';
import { useConfirm } from '@/components/ConfirmProvider';
import { useToast } from '@/components/ToastProvider';
import { AdminError, AdminLoading, StatTile, errText, useAdminData, useAdminFormat } from '@/components/admin/adminShared';

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 'var(--font-size-small)' }}>
      <span className="text-muted" style={{ minWidth: 110 }}>{label}</span>
      <span style={{ color: 'var(--text-strong)', overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  );
}

export function VisitorLeadDetail({
  visitorId,
  session,
  onErased,
}: {
  visitorId: string;
  session: AdminGuestSession | null;
  /** Called after a successful erase; the host closes the panel. */
  onErased?: () => void;
}) {
  const t = useTranslations('admin.sessions');
  const { fmtDateTime, fmtNum } = useAdminFormat();
  const confirm = useConfirm();
  const toast = useToast();
  const [erasing, setErasing] = useState(false);
  const { data: prompts, loading, error } = useAdminData<AdminGuestPrompt[]>(
    () => adminApi.guestPrompts(visitorId).catch((err) => {
      throw new Error(errText(err));
    }),
    [visitorId],
  );

  async function erase() {
    if (!(await confirm({
      message: t('eraseConfirm'),
      confirmLabel: t('erase'),
      destructive: true,
    }))) return;
    setErasing(true);
    try {
      const count = await adminApi.forgetGuestPrompts(visitorId);
      toast.success(t('eraseDone', { count }));
      onErased?.();
    } catch (err) {
      toast.error(t('eraseFailed'));
      void err;
    } finally {
      setErasing(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontFamily: 'monospace', fontSize: 'var(--font-size-small)', overflowWrap: 'anywhere', minWidth: 0 }}>
          {visitorId}
        </div>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => void erase()}
          disabled={erasing}
          aria-label={t('eraseAria', { visitor: visitorId })}
        >
          {t('erase')}
        </button>
      </div>

      {session && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <StatTile label={t('metricPrompts')} value={fmtNum(session.promptCount)} />
            <StatTile label={t('metricMessages')} value={fmtNum(session.guestChatCount)} />
            <StatTile label={t('metricTokens')} value={fmtNum(session.guestChatTokens)} />
            <StatTile label={t('metricToolRuns')} value={fmtNum(session.toolRuns)} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {session.convertedEmail && <DetailRow label={t('metricAccount')} value={session.convertedEmail} />}
            {session.convertedAt && <DetailRow label={t('metricSignedUpAt')} value={fmtDateTime(session.convertedAt)} />}
            <DetailRow label={t('metricLanding')} value={session.landingPath ?? '—'} />
            <DetailRow label={t('metricReferrer')} value={session.referrer ?? '—'} />
            <DetailRow label={t('metricFirstSeen')} value={fmtDateTime(session.firstSeenAt)} />
            <DetailRow label={t('metricLastSeen')} value={fmtDateTime(session.lastSeenAt)} />
            <DetailRow label={t('metricLastSurface')} value={session.lastSurface ?? '—'} />
          </div>
        </>
      )}

      <h3 style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-strong)' }}>
        {t('promptHistory')}
      </h3>
      <AdminError message={error} />
      {loading ? (
        <AdminLoading />
      ) : !prompts || prompts.length === 0 ? (
        <p className="text-muted" style={{ margin: 0 }}>{t('noPrompt')}</p>
      ) : (
        prompts.map((prompt) => (
          <article
            key={prompt.id}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: 10,
            }}
          >
            <div className="text-muted" style={{ fontSize: 'var(--font-size-small)' }}>
              {t('promptRowMeta', { surface: prompt.surface, at: fmtDateTime(prompt.createdAt) })}
            </div>
            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: 4 }}>{prompt.prompt}</div>
          </article>
        ))
      )}
    </div>
  );
}

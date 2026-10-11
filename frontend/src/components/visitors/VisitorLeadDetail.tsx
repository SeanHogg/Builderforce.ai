/**
 * The lead body of a recording — funnel numbers, contact fields, and the prompt
 * history. RecordingPanel owns the chrome; this owns the fetch so a surface that
 * already has a session row can pass it in without a second list round-trip.
 */

import { type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi, type AdminGuestPrompt, type AdminGuestSession } from '@/lib/adminApi';
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
  reloadToken = 0,
}: {
  visitorId: string;
  session: AdminGuestSession | null;
  /** Bumped after erase so the prompt history refetches without unmounting. */
  reloadToken?: number;
}) {
  const t = useTranslations('admin.sessions');
  const { fmtDateTime, fmtNum } = useAdminFormat();
  const { data: prompts, loading, error } = useAdminData<AdminGuestPrompt[]>(
    () => adminApi.guestPrompts(visitorId).catch((err) => {
      throw new Error(errText(err));
    }),
    [visitorId, reloadToken],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontFamily: 'monospace', fontSize: 'var(--font-size-small)', overflowWrap: 'anywhere' }}>
        {visitorId}
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

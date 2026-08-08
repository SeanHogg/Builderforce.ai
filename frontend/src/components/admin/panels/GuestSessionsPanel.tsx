'use client';

/**
 * Adoption sessions — the anonymous funnel, with what people actually asked for.
 *
 * A visitor who types a prompt into the landing composer IS a lead, and this is
 * the only place that funnel is visible end to end: the intent in their own
 * words, whether they came back, whether they signed up, whether they paid.
 * Before migration 0434 the intent column did not exist — the prompt went to the
 * model and was discarded — so this panel could show engagement counts and
 * nothing about what any of it was FOR.
 *
 * Answer-first: the five funnel numbers lead, the leads follow, and the row
 * itself carries the prompt rather than hiding it behind a click. Opening a lead
 * shows their whole prompt history and offers the one action worth having here —
 * send them a message.
 */

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  adminApi,
  type AdminGuestPrompt,
  type AdminGuestSession,
  type AdminGuestSessionsPage,
} from '@/lib/adminApi';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import {
  AdminError,
  AdminLoading,
  AdminPanelHeader,
  errText,
  fmtDateTime,
  fmtNum,
  useAdminData,
} from '@/components/admin/adminShared';
import { BroadcastComposer } from './BroadcastComposer';

/** One headline number. Five of these are the panel's answer row. */
function FunnelStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div
      style={{
        flex: '1 1 140px',
        minWidth: 120,
        padding: '12px 14px',
        border: '1px solid var(--border)',
        borderRadius: 10,
        background: 'var(--surface-card)',
      }}
    >
      <div className="text-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-strong)', marginTop: 2 }}>{value}</div>
      {hint && <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

export default function GuestSessionsPanel() {
  const t = useTranslations('admin.sessions');
  const { data, loading, error, reload } = useAdminData<AdminGuestSessionsPage>(() => adminApi.guestSessions());

  const [openVisitor, setOpenVisitor] = useState<AdminGuestSession | null>(null);
  const [prompts, setPrompts] = useState<AdminGuestPrompt[]>([]);
  const [promptsError, setPromptsError] = useState<string | null>(null);
  const [loadingPrompts, setLoadingPrompts] = useState(false);
  const [messaging, setMessaging] = useState<AdminGuestSession | null>(null);

  const openLead = useCallback(async (session: AdminGuestSession) => {
    setOpenVisitor(session);
    setPrompts([]);
    setPromptsError(null);
    setLoadingPrompts(true);
    try {
      setPrompts(await adminApi.guestPrompts(session.visitorId));
    } catch (err) {
      setPromptsError(errText(err));
    } finally {
      setLoadingPrompts(false);
    }
  }, []);

  if (loading && !data) return <AdminLoading />;

  const sessions = data?.sessions ?? [];
  const summary = data?.summary;

  return (
    <div>
      <AdminPanelHeader
        title={t('title')}
        subtitle={t('subtitle')}
        count={t('count', { count: sessions.length })}
        onRefresh={reload}
      />
      <AdminError message={error} />

      {summary && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
          <FunnelStat label={t('statSessions')} value={fmtNum(summary.sessions)} />
          <FunnelStat
            label={t('statStatedIntent')}
            value={fmtNum(summary.sessionsWithPrompt)}
            hint={t('statPromptsHint', { count: summary.prompts })}
          />
          <FunnelStat label={t('statRegistered')} value={fmtNum(summary.registered)} />
          <FunnelStat label={t('statPaid')} value={fmtNum(summary.paid)} />
          <FunnelStat
            label={t('statConversion')}
            value={`${summary.conversionPct}%`}
            hint={t('statConversionHint')}
          />
        </div>
      )}

      {sessions.length === 0 ? (
        <p className="text-muted" style={{ padding: 24 }}>{t('empty')}</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('visitor')}</th>
                <th>{t('intent')}</th>
                <th>{t('engagement')}</th>
                <th>{t('lastSeen')}</th>
                <th>{t('conversion')}</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.id}>
                  <td>
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{ fontFamily: 'monospace', fontSize: 12, padding: 0, textAlign: 'left' }}
                      onClick={() => void openLead(session)}
                    >
                      {session.visitorId}
                    </button>
                    <div className="text-muted" style={{ fontSize: 12 }}>{session.landingPath ?? '—'}</div>
                  </td>
                  <td style={{ maxWidth: 380 }}>
                    {session.firstPrompt ? (
                      <>
                        <div style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{session.firstPrompt}</div>
                        <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
                          {t('promptMeta', { count: session.promptCount, surface: session.lastSurface ?? '—' })}
                        </div>
                      </>
                    ) : (
                      <span className="text-muted" style={{ fontSize: 12 }}>{t('noPrompt')}</span>
                    )}
                  </td>
                  <td>
                    <div>{t('brainMessages', { count: session.guestChatCount })}</div>
                    <div className="text-muted" style={{ fontSize: 12 }}>
                      {t('tokensAndTools', { tokens: fmtNum(session.guestChatTokens), tools: fmtNum(session.toolRuns) })}
                    </div>
                  </td>
                  <td className="text-muted">
                    {fmtDateTime(session.lastSeenAt)}
                    <div style={{ fontSize: 12 }}>{t('firstSeenAt', { at: fmtDateTime(session.firstSeenAt) })}</div>
                  </td>
                  <td>
                    {session.isPaid ? (
                      <span className="badge badge-success">{t('paid')}</span>
                    ) : session.converted ? (
                      <span className="badge badge-neutral">{t('registered')}</span>
                    ) : (
                      <span className="badge badge-neutral">{t('guest')}</span>
                    )}
                    {session.convertedEmail && (
                      <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>{session.convertedEmail}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SlideOutPanel
        open={!!openVisitor}
        onClose={() => setOpenVisitor(null)}
        title={t('drawerTitle')}
        headerActions={openVisitor && (
          <button type="button" className="btn-primary" onClick={() => setMessaging(openVisitor)}>
            {t('messageVisitor')}
          </button>
        )}
      >
        {openVisitor && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontFamily: 'monospace', fontSize: 12, overflowWrap: 'anywhere' }}>{openVisitor.visitorId}</div>
            <div className="text-muted" style={{ fontSize: 12 }}>
              {t('drawerMeta', {
                landing: openVisitor.landingPath ?? '—',
                referrer: openVisitor.referrer ?? '—',
              })}
            </div>

            <AdminError message={promptsError} />
            {loadingPrompts ? (
              <AdminLoading />
            ) : prompts.length === 0 ? (
              <p className="text-muted" style={{ fontSize: 13 }}>{t('noPrompt')}</p>
            ) : (
              <ol style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: 0, padding: 0, listStyle: 'none' }}>
                {prompts.map((prompt) => (
                  <li
                    key={prompt.id}
                    style={{
                      padding: '10px 12px',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      background: 'var(--surface-card)',
                    }}
                  >
                    <div style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{prompt.prompt}</div>
                    <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                      {t('promptRowMeta', { surface: prompt.surface, at: fmtDateTime(prompt.createdAt) })}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </SlideOutPanel>

      {/* The composer is the SAME one the Broadcasts panel uses — a message aimed
          at one visitor and a message aimed at everybody differ by an audience
          field, not by a form. */}
      <BroadcastComposer
        open={!!messaging}
        onClose={() => setMessaging(null)}
        targetVisitorId={messaging?.visitorId ?? null}
        onSaved={() => { setMessaging(null); reload(); }}
      />
    </div>
  );
}

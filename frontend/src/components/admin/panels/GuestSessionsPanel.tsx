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
 * itself carries the prompt rather than hiding it behind a click.
 *
 * ── WHY THE PROMPT IS CLAMPED ────────────────────────────────────────────────
 * It used to render in full. The measured prompts are course briefs running past
 * 900 characters, so ONE row filled the viewport and the table stopped being a
 * table: nothing below the first lead was reachable without a page of scrolling,
 * and the funnel numbers this panel leads with scrolled away with them. The row
 * is a summary — three lines of intent is enough to recognise a lead — and the
 * full text is one click away in the drawer, which is what the Actions column is
 * for. The header stays put while that list scrolls, because a sorted column
 * whose label has scrolled off is a column you have to re-derive.
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  adminApi,
  type AdminGuestPrompt,
  type AdminGuestSession,
  type AdminGuestSessionsPage,
} from '@/lib/adminApi';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { CopyButton } from '@/components/CopyButton';
import { captureDiagnosticsContext } from '@/lib/diagnosticsCapture';
import { buildGuestSessionReport } from '@/lib/guestSessionDiagnostics';
import {
  AdminError,
  AdminLoading,
  AdminPanelHeader,
  SortableTh,
  errText,
  fmtDateTime,
  fmtNum,
  useAdminData,
  useTableSort,
} from '@/components/admin/adminShared';
import { BroadcastComposer } from './BroadcastComposer';

/** One headline number. Five of these are the panel's answer row, and the same
 *  tile carries the per-visitor counts in the drawer — one lead's engagement and
 *  the platform's funnel are the same kind of fact at different scopes. */
function FunnelStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div
      style={{
        flex: '1 1 140px',
        minWidth: 120,
        padding: '12px 14px',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--surface-card)',
      }}
    >
      <div className="text-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-strong)', marginTop: 2 }}>{value}</div>
      {hint && <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

/** One `label: value` line in the drawer's detail block. */
function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 13 }}>
      <span className="text-muted" style={{ minWidth: 110 }}>{label}</span>
      <span style={{ color: 'var(--text-strong)', overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  );
}

/**
 * The ONE "copy this lead" control — used by the row action and by the drawer
 * header, so a capture is identical wherever it was taken from.
 *
 * The prompt history is NOT on the session row (the table would be a join per
 * visitor), so it is fetched on click. That is also what makes the capture
 * honest: fetching on render would stamp a report "now" while carrying rows
 * loaded minutes earlier. A failed fetch degrades to a report that SAYS the
 * history could not be loaded rather than to one that silently reads as
 * "this visitor typed nothing".
 */
function GuestSessionCopyButton({ session, compact }: { session: AdminGuestSession; compact?: boolean }) {
  const t = useTranslations('admin.sessions');

  const buildReport = useCallback(async (): Promise<string> => {
    const prompts = await adminApi.guestPrompts(session.visitorId).catch(() => null);
    return buildGuestSessionReport(
      {
        session,
        prompts,
        promptsError: prompts === null ? 'the prompt history could not be loaded' : null,
      },
      await captureDiagnosticsContext(),
    );
  }, [session]);

  return (
    <CopyButton
      getText={buildReport}
      ariaLabel={t('copyAria', { visitor: session.visitorId })}
      compact={compact}
    />
  );
}

type SessionSortKey = 'visitor' | 'intent' | 'engagement' | 'lastSeen' | 'conversion';

/** Where a visitor got to, as a rank — so "Conversion" sorts along the funnel
 *  rather than alphabetically by badge text. Mirrors `funnelOutcome`. */
function outcomeRank(session: AdminGuestSession): number {
  return session.isPaid ? 2 : session.converted ? 1 : 0;
}

/** An unparseable stamp sorts as the epoch rather than as NaN, which would make
 *  the comparator inconsistent and leave the whole column in an arbitrary order. */
function stampValue(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Ascending comparators, one per sortable column; the hook reverses them for
 * descending so a column cannot sort correctly one way and wrongly the other.
 *
 * Ties break on `lastSeenAt` because these columns are coarse — most visitors
 * share a conversion state and many share a message count — and a coarse sort
 * that leaves ties in arbitrary order reads as a broken one.
 */
const SESSION_COMPARATORS: Record<SessionSortKey, (a: AdminGuestSession, b: AdminGuestSession) => number> = {
  visitor: (a, b) => a.visitorId.localeCompare(b.visitorId),
  intent: (a, b) => (a.promptCount - b.promptCount) || (stampValue(a.lastSeenAt) - stampValue(b.lastSeenAt)),
  engagement: (a, b) =>
    (a.guestChatCount - b.guestChatCount)
    || (a.guestChatTokens - b.guestChatTokens)
    || (stampValue(a.lastSeenAt) - stampValue(b.lastSeenAt)),
  lastSeen: (a, b) => stampValue(a.lastSeenAt) - stampValue(b.lastSeenAt),
  conversion: (a, b) => (outcomeRank(a) - outcomeRank(b)) || (stampValue(a.lastSeenAt) - stampValue(b.lastSeenAt)),
};

/** Newest contact first — the order a growth reader opens this list wanting. */
const INITIAL_SORT = { key: 'lastSeen', direction: 'desc' } as const;

export default function GuestSessionsPanel() {
  const t = useTranslations('admin.sessions');
  const tCommon = useTranslations('common');
  const { data, loading, error, reload } = useAdminData<AdminGuestSessionsPage>(() => adminApi.guestSessions());

  const [openVisitor, setOpenVisitor] = useState<AdminGuestSession | null>(null);
  const [prompts, setPrompts] = useState<AdminGuestPrompt[]>([]);
  const [promptsError, setPromptsError] = useState<string | null>(null);
  const [loadingPrompts, setLoadingPrompts] = useState(false);
  const [messaging, setMessaging] = useState<AdminGuestSession | null>(null);

  const sessions = useMemo(() => data?.sessions ?? [], [data]);
  const { sort, toggle, sorted } = useTableSort<SessionSortKey, AdminGuestSession>(
    sessions,
    SESSION_COMPARATORS,
    INITIAL_SORT,
  );

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
        <div className="table-wrap table-wrap--sticky">
          <table className="data-table">
            <thead>
              <tr>
                <SortableTh columnKey="visitor" label={t('visitor')} sort={sort} onSort={toggle} sortLabel={t('sortBy', { column: t('visitor') })} />
                <SortableTh columnKey="intent" label={t('intent')} sort={sort} onSort={toggle} sortLabel={t('sortByIntent')} />
                <SortableTh columnKey="engagement" label={t('engagement')} sort={sort} onSort={toggle} sortLabel={t('sortBy', { column: t('engagement') })} />
                <SortableTh columnKey="lastSeen" label={t('lastSeen')} sort={sort} onSort={toggle} sortLabel={t('sortBy', { column: t('lastSeen') })} />
                <SortableTh columnKey="conversion" label={t('conversion')} sort={sort} onSort={toggle} sortLabel={t('sortBy', { column: t('conversion') })} />
                <th>{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((session) => (
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
                  <td style={{ maxWidth: 380, minWidth: 220 }}>
                    {session.firstPrompt ? (
                      <>
                        {/* `title` carries the full text for a pointer; the drawer
                            carries it for everyone else. */}
                        <div className="text-clamp" style={{ fontSize: 13 }} title={session.firstPrompt}>
                          {session.firstPrompt}
                        </div>
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
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => void openLead(session)}
                        aria-label={t('viewAria', { visitor: session.visitorId })}
                        style={{ whiteSpace: 'nowrap' }}
                      >
                        {tCommon('view')}
                      </button>
                      <GuestSessionCopyButton session={session} compact />
                    </div>
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
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <GuestSessionCopyButton session={openVisitor} compact />
            <button type="button" className="btn-primary" onClick={() => setMessaging(openVisitor)}>
              {t('messageVisitor')}
            </button>
          </div>
        )}
      >
        {openVisitor && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontFamily: 'monospace', fontSize: 12, overflowWrap: 'anywhere' }}>{openVisitor.visitorId}</div>

            {/* The numbers the row could only hint at, at the scope they belong to. */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <FunnelStat label={t('metricPrompts')} value={fmtNum(openVisitor.promptCount)} />
              <FunnelStat label={t('metricMessages')} value={fmtNum(openVisitor.guestChatCount)} />
              <FunnelStat label={t('metricTokens')} value={fmtNum(openVisitor.guestChatTokens)} />
              <FunnelStat label={t('metricToolRuns')} value={fmtNum(openVisitor.toolRuns)} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <DetailRow
                label={t('conversion')}
                value={openVisitor.isPaid ? t('paid') : openVisitor.converted ? t('registered') : t('guest')}
              />
              {openVisitor.convertedEmail && <DetailRow label={t('metricAccount')} value={openVisitor.convertedEmail} />}
              {openVisitor.convertedAt && <DetailRow label={t('metricSignedUpAt')} value={fmtDateTime(openVisitor.convertedAt)} />}
              <DetailRow label={t('metricLanding')} value={openVisitor.landingPath ?? '—'} />
              <DetailRow label={t('metricReferrer')} value={openVisitor.referrer ?? '—'} />
              <DetailRow label={t('metricFirstSeen')} value={fmtDateTime(openVisitor.firstSeenAt)} />
              <DetailRow label={t('metricLastSeen')} value={fmtDateTime(openVisitor.lastSeenAt)} />
              <DetailRow label={t('metricLastSurface')} value={openVisitor.lastSurface ?? '—'} />
            </div>

            <div>
              <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 8px', color: 'var(--text-strong)' }}>
                {t('promptHistory')}
              </h3>
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
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--surface-card)',
                      }}
                    >
                      {/* Unclamped on purpose — the drawer is where the full text
                          lives, and clamping it here would leave nowhere to read it. */}
                      <div style={{ fontSize: 13, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{prompt.prompt}</div>
                      <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                        {t('promptRowMeta', { surface: prompt.surface, at: fmtDateTime(prompt.createdAt) })}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
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
